/**
 * 用 MSE 把 B 站 dash 的视频轨 + 音频轨合成到一个 `<video>` 上
 *
 * 为什么需要它：
 * dash 的音视频是**两条独立的流**，直接拿视频轨当地址播会没有声音。
 * 而 `<video>` 一次只能播一个 URL，所以要把两轨都塞进 MediaSource 的
 * 两个 SourceBuffer 里 —— 这样对外仍然只有一个媒体元素，
 * 进度、音量、续播、SMTC 这些现有逻辑一行都不用改。
 *
 * 关于内存 / 配额（实测踩过的坑）：
 * 1080P60 的 4 分钟视频整条流约 150MB，正好顶到 Chromium 单个 SourceBuffer
 * 的配额，`appendBuffer` 会抛 `QuotaExceededError`，一旦不处理，
 * 之后再也塞不进任何数据、播放卡死。所以这里做两件事：
 *  1. **限流**：只往播放位置前面缓冲 `MAX_AHEAD_S` 秒，超了就等播放推进；
 *  2. **裁剪**：配额超限时丢掉播放位置之前的数据（保留 `KEEP_BEHIND_S` 秒回看），
 *     并按次数逐级加大丢弃幅度再重试。
 */

/** DashSession 需要的媒体元素能力（项目里用的是精简的 VideoElement 接口） */
export interface MediaElementLike {
  src: string
  readonly currentTime: number
  readonly buffered: TimeRanges
}

export interface DashSource {
  videoUrl: string
  audioUrl: string
  videoMime: string
  audioMime: string
  /** dash 总时长（秒），用来补 MediaSource.duration */
  duration: number | null
}

/** 往播放位置前面最多缓冲多少秒（控制内存） */
const MAX_AHEAD_S = 30
/** 配额超限裁剪时，播放位置之前保留多少秒供回拖 */
const KEEP_BEHIND_S = 90
/** 裁剪重试时的递减保留秒数 */
const KEEP_BEHIND_STEPS = [KEEP_BEHIND_S, 45, 20, 8, 2, 0]
/** SourceBuffer 空闲等待的超时（避免异常情况下永久挂住） */
const UPDATE_TIMEOUT_MS = 15000

/** SourceBuffer 配额超限（缓冲区放不下了）*/
const isQuotaError = (err: unknown): boolean =>
  typeof DOMException !== 'undefined' &&
  err instanceof DOMException &&
  (err.name === 'QuotaExceededError' || err.code === 22)

/** 一条 dash 流的下载与 append 任务 */
interface TrackTask {
  buffer: SourceBuffer
  url: string
  controller: AbortController
}

export class DashSession {
  private el: MediaElementLike
  private mediaSource: MediaSource | null = null
  private objectUrl: string | null = null
  private tasks: TrackTask[] = []
  private stopped = false

  constructor(el: MediaElementLike) {
    this.el = el
  }

  /** 当前浏览器/Electron 是否支持这两条流的编码 */
  static isSupported(source: DashSource): boolean {
    if (typeof MediaSource === 'undefined') return false
    try {
      return (
        MediaSource.isTypeSupported(source.videoMime) &&
        MediaSource.isTypeSupported(source.audioMime)
      )
    } catch {
      return false
    }
  }

  /**
   * 开始播放
   *
   * 失败会抛错，调用方应改用 durl（720P 混流）那条路。
   * 注意：正常返回意味着**两条流都已经取完**，中途失败一律抛错，
   * 因为只拿到一半（黑屏有声 / 哑巴）比退回 720P 更糟。
   */
  async start(source: DashSource): Promise<void> {
    this.stop()
    // stop() 会把 stopped 置为 true，这里必须复位，
    // 否则 append() 每次都在第一行直接返回 —— 流被读完却一个字节都没进 buffer
    this.stopped = false

    const ms = new MediaSource()
    this.mediaSource = ms
    this.objectUrl = URL.createObjectURL(ms)
    this.el.src = this.objectUrl

    const [videoBuffer, audioBuffer] = await new Promise<[SourceBuffer, SourceBuffer]>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('MediaSource 打开超时')), 10000)
        ms.addEventListener(
          'sourceopen',
          () => {
            clearTimeout(timer)
            try {
              const v = ms.addSourceBuffer(source.videoMime)
              const a = ms.addSourceBuffer(source.audioMime)
              resolve([v, a])
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)))
            }
          },
          { once: true },
        )
      },
    ).catch((err) => {
      this.stop()
      throw err
    })

    // 分片 MP4 的 mvhd 时长经常是 0，不补的话进度条会拿到 Infinity
    if (source.duration && source.duration > 0) {
      try {
        ms.duration = source.duration
      } catch {
        /* 已经确定下来的 duration 改不了，忽略 */
      }
    }

    this.tasks = [
      { buffer: videoBuffer, url: source.videoUrl, controller: new AbortController() },
      { buffer: audioBuffer, url: source.audioUrl, controller: new AbortController() },
    ]

    // 两条流并行拉取，互不阻塞
    const results = await Promise.allSettled(this.tasks.map((t) => this.pump(t)))
    if (this.stopped) return

    const failed = results.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined
    if (failed) {
      this.stop()
      throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason))
    }
    if (ms.readyState === 'open') {
      try {
        ms.endOfStream()
      } catch {
        /* 已经结束了，忽略 */
      }
    }
  }

  /** 顺序把一条流取完并 append 进对应 SourceBuffer */
  private async pump(task: TrackTask): Promise<void> {
    const res = await fetch(task.url, { signal: task.controller.signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

    const reader = res.body.getReader()
    try {
      for (;;) {
        await this.waitForRoom(task.buffer)
        if (this.stopped) break
        const { done, value } = await reader.read()
        if (done || this.stopped) break
        if (!value || value.byteLength === 0) continue
        await this.append(task.buffer, value)
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* 忽略 */
      }
    }
  }

  /**
   * 缓冲太多就先等着
   *
   * 不做这一步的话会把整条流（1080P60 四分钟约 150MB）一次性塞进内存，
   * 直接撞上 SourceBuffer 配额。
   */
  private async waitForRoom(buffer: SourceBuffer): Promise<void> {
    for (;;) {
      if (this.stopped) return
      if (!buffer.buffered.length) return
      const ahead = buffer.buffered.end(buffer.buffered.length - 1) - this.el.currentTime
      if (ahead <= MAX_AHEAD_S) return
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  /** 等 SourceBuffer 空闲再 append（同一时刻只能有一个 append 在进行） */
  private async append(buffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      await this.waitIdle(buffer)
      if (this.stopped) return
      try {
        // Uint8Array 与 BufferSource 的泛型在 TS 5.9 里不完全兼容，这里收窄
        buffer.appendBuffer(chunk as unknown as BufferSource)
        return
      } catch (err) {
        if (!isQuotaError(err)) {
          throw err instanceof Error ? err : new Error(String(err))
        }
        const keep = KEEP_BEHIND_STEPS[Math.min(attempt, KEEP_BEHIND_STEPS.length - 1)]
        const freed = await this.trim(buffer, keep)
        if (!freed) {
          throw new Error('SourceBuffer 配额超限，且没有可丢弃的已播数据')
        }
      }
    }
  }

  /** 等 SourceBuffer 不处于 updating */
  private async waitIdle(buffer: SourceBuffer): Promise<void> {
    while (buffer.updating && !this.stopped) {
      const timedOut = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(true), UPDATE_TIMEOUT_MS)
        buffer.addEventListener(
          'updateend',
          () => {
            clearTimeout(timer)
            resolve(false)
          },
          { once: true },
        )
      })
      if (timedOut) throw new Error('SourceBuffer 长时间处于 updating')
    }
  }

  /**
   * 丢掉播放位置之前的缓冲，给新数据腾地方
   *
   * @param keepBehind 播放位置之前保留多少秒
   * @returns 是否真的丢掉了东西（false 表示丢不动了）
   */
  private async trim(buffer: SourceBuffer, keepBehind: number): Promise<boolean> {
    if (!buffer.buffered.length) return false
    const start = buffer.buffered.start(0)
    const now = this.el.currentTime
    let cutTo = Math.max(start, now - keepBehind)
    // keepBehind 为 0 或播放位置紧贴缓冲区起点时，退一步：丢到播放位置前 1 秒
    if (cutTo - start < 1) cutTo = Math.max(start, now - 1)
    if (cutTo - start < 1) return false

    await this.waitIdle(buffer)
    if (this.stopped) return false
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), UPDATE_TIMEOUT_MS)
      buffer.addEventListener(
        'updateend',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      try {
        buffer.remove(start, cutTo)
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
    return true
  }

  /** 停止并清理（换源 / 切歌 / 组件卸载时务必调用） */
  stop(): void {
    this.stopped = true
    for (const t of this.tasks) {
      try {
        t.controller.abort()
      } catch {
        /* 忽略 */
      }
    }
    this.tasks = []
    const ms = this.mediaSource
    this.mediaSource = null
    if (ms) {
      try {
        if (ms.readyState === 'open') ms.endOfStream()
      } catch {
        /* 忽略 */
      }
    }
    if (this.objectUrl) {
      try {
        URL.revokeObjectURL(this.objectUrl)
      } catch {
        /* 忽略 */
      }
      this.objectUrl = null
    }
  }
}
