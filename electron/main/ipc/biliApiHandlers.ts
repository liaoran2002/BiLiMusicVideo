/**
 * B 站接口相关 IPC
 *
 * 逻辑与迁移前的 electron/ipcHandlers.js 保持一致，仅补充类型。
 */
import { mainHandle } from '@common/mainIpc'
import { AUDIO_QUALITY_OPTIONS, findQualityOption, qualityLabelOf } from '@common/constants'
import * as biliApi from '../biliApi'
import { isUrlUsable, readQualityOptions } from '../biliApi'
import type { DashStreams } from '../biliApi'
import { getSetting } from '../utils/setting'
import { readVideoQuality } from '../utils/quality'
import type * as cacheManager from '../utils/cache'

/** 缓存总开关（cache.enable 之前也是死的，顺手接上） */
const cacheEnabled = (): boolean => getSetting()['cache.enable']

interface ApiContext {
  biliApi: typeof biliApi
  cacheManager: typeof cacheManager
}

/**
 * 缓存里的一条搜索结果条目
 *
 * `title` / `pic` / `author` 等字段直接来自 B 站搜索接口，
 * 解析播放地址时**必须原样保留**（见 resolveVideo 里的合并注释）。
 */
interface CachedSearchItem {
  bvid: string
  title?: string
  pic?: string
  author?: string
  duration?: number
  view_result?: BiliApiResponse
  playurl_result?: BiliApiResponse & {
    loginState?: boolean
    /** 这次解析有没有试过 dash（试过但没拿到，下次就别反复重取） */
    dashTried?: boolean
  }
  [key: string]: unknown
}

type BiliApiResponse = Awaited<ReturnType<typeof biliApi.resolveVideoUrl>>['viewData']

/** 搜索接口返回体里真正带 data 的那层（见 biliApi.searchSong） */
interface SearchPayload {
  data?: {
    result?: CachedSearchItem[]
    selectedBvid?: string
  }
}

/**
 * 取 durl（渐进式 mp4）地址
 *
 * dash 的双轨不在这里处理 —— 它需要两条流一起给，见 `extractDashStreams`。
 */
const extractDurl = (playData: BiliApiResponse | undefined): string | null => {
  const durl = (playData?.data as { durl?: Array<{ url?: string }> } | undefined)?.durl
  const url = durl?.[0]?.url
  return typeof url === 'string' && url ? url : null
}

/**
 * 用 `view_result` 里的信息补齐搜索条目缺失的 `title` / `pic`
 *
 * 旧版本解析播放地址时把条目整个替换成 `{ bvid, view_result, playurl_result }`，
 * 丢掉了标题和封面并写回了缓存。这类坏数据不会自己好：
 * 缓存命中时走的是「地址还能用」分支，根本不会碰条目。
 * 所以每次解析都顺手回填一次，让坏缓存随使用自愈。
 */
const backfillFromView = (item: CachedSearchItem): CachedSearchItem => {
  const info = item.view_result?.data
  const title =
    typeof item.title === 'string' && item.title
      ? item.title
      : typeof info?.title === 'string'
        ? info.title
        : undefined
  const pic =
    typeof item.pic === 'string' && item.pic
      ? item.pic
      : typeof info?.pic === 'string'
        ? info.pic
        : undefined
  return {
    ...item,
    ...(title ? { title } : {}),
    ...(pic ? { pic } : {}),
  }
}

export const registerApiHandlers = (context: ApiContext): void => {
  const { cacheManager } = context

  mainHandle('api:getUserInfo', () => biliApi.getUserInfo())

  mainHandle('api:searchSong', async ({ keyword }) => {
    if (!keyword || !keyword.trim()) {
      throw new Error('关键词不能为空')
    }

    const cached = cacheEnabled() ? await cacheManager.get<SearchPayload>(keyword) : null
    if (cached && cached.data) {
      // 缓存里存的是上一次的完整返回体，这里还原成调用方期望的 { data }
      const payload = cached.data as unknown as SearchPayload
      return { data: payload.data ?? cached.data }
    }

    const result = await biliApi.searchSong(keyword)

    if (result.code !== 0) {
      throw new Error(result.message ?? '搜索失败')
    }
    const results = result.data?.result
    if (Array.isArray(results)) {
      result.data!.result = results.filter(
        (item) => (item as { type?: string }).type === 'video',
      )
    }
    if (cacheEnabled()) await cacheManager.save(keyword, result)
    return { data: result.data ?? [] }
  })

  mainHandle('api:resolveVideo', async ({ bvid, keyword, skipCache, noDash, qn, audioId }) => {
    try {
      /**
       * 每次解析前都确认一次登录态（必要时重拉 nav）。
       *
       * 不能直接读缓存的登录标志：登录窗口刚登录完时那份 nav 数据还是「未登录」，
       * 用它判断会把「该重新解析成更高清晰度」误判成「缓存可用」，
       * 于是登录后播放清晰度不变、必须重启才生效。
       */
      const loggedIn = await biliApi.ensureLoginState()
      // 本次要用的清晰度 / 音质：调用方（播放器上手动切换）优先，否则用设置里的默认值
      const wantQn = qn ?? getSetting()['player.videoQuality']
      const wantAudioId = audioId ?? getSetting()['player.audioQuality']

      /** durl（渐进式 mp4）地址；走 dash 时为 null */
      let videoUrl: string | null = null
      /** dash 双轨（音视频分开）；走 durl 时为 null */
      let dash: DashStreams | null = null
      let viewData: BiliApiResponse | undefined
      let playData: BiliApiResponse | undefined
      let cached: Awaited<ReturnType<typeof cacheManager.get<SearchPayload>>> = null
      let results: CachedSearchItem[] = []

      // 读取缓存（有 keyword 才走缓存逻辑）
      if (keyword && cacheEnabled()) {
        cached = await cacheManager.get<SearchPayload>(keyword)
        const payload = cached?.data as unknown as SearchPayload | undefined
        results = Array.isArray(payload?.data?.result) ? payload.data.result : []
      }

      // 在缓存列表中查找当前 bvid 对应的视频项
      const targetIndex = results.findIndex((item) => item.bvid === bvid)
      let targetVideo: CachedSearchItem | undefined = results[targetIndex]

      // 分支：使用缓存 / 重新解析
      if (targetVideo && !skipCache) {
        const prevDashTried = targetVideo.playurl_result?.dashTried === true
        const cachedDurl = extractDurl(targetVideo.playurl_result)
        const cachedDash = biliApi.extractDashStreams(
          targetVideo.playurl_result,
          wantQn,
          wantAudioId,
        )
        const hasValidData = Boolean(targetVideo.view_result && targetVideo.playurl_result)
        /**
         * 缓存是不是「未登录时取的」。
         *
         * `loginState` 是解析当时由主进程写进缓存的登录态快照。
         * 未登录能拿到的清晰度被平台压得很低（实测只有 360P/720P），
         * 所以「缓存是未登录时取的 + 现在已登录」必须重取，
         * 否则登录完还得重启才看得到高清。
         */
        const cachedLoggedIn = targetVideo.playurl_result?.loginState === true
        const loginChanged = loggedIn && !cachedLoggedIn
        /**
         * 关键：以前只判断「缓存里有没有数据」，从不检查播放地址是否过期。
         * B 站直链带签名时效（deadline），实测缓存里 38 条地址有 21 条已过期，
         * 于是播放器拿到死链 -> 触发 error -> 用户看到「视频加载失败，已跳过」。
         * 这里加上时效校验，过期就重新解析。dash 的两条流都要检查。
         */
        const urlUsable =
          isUrlUsable(cachedDurl ?? cachedDash?.videoUrl ?? null) &&
          (!cachedDash || isUrlUsable(cachedDash.audioUrl))
        // 想要 dash、缓存里却没有，且之前没试过 dash -> 重取一次做升级
        const needDashUpgrade = !noDash && !cachedDash && !prevDashTried
        // 明确要求 durl（dash 播放失败后的兜底）但缓存只有 dash -> 也要重取
        const needDurl = Boolean(noDash) && !cachedDurl

        if (hasValidData && !loginChanged && urlUsable && !needDashUpgrade && !needDurl) {
          videoUrl = cachedDurl
          dash = cachedDash
        } else {
          if (loginChanged) {
            console.log('[video] 缓存的地址是未登录时取的，现已登录，重新解析:', bvid)
          }
          if (!urlUsable && (cachedDurl || cachedDash)) {
            console.log('[video] 缓存的播放地址已过期，重新解析:', bvid)
          }
          if (needDashUpgrade) {
            console.log('[video] 缓存只有 720P 的 durl，重新解析以尝试 dash 高清:', bvid)
          }
          // 缓存数据失效 / 地址过期，重新拉取
          const resolved = await biliApi.resolveVideoUrl(bvid, {
            noDash,
            qn: wantQn,
            audioId: wantAudioId,
          })
          videoUrl = resolved.videoUrl
          dash = resolved.dash
          viewData = resolved.viewData
          playData = resolved.playData
          targetVideo.view_result = viewData
          targetVideo.playurl_result = {
            ...playData,
            loginState: loggedIn,
            // 记下「这次试过 dash」：试过但没拿到，下次就别反复重取
            dashTried: !noDash || prevDashTried,
          }
        }
      } else {
        // 无缓存项 / 强制跳过缓存：直接调用接口解析
        const resolved = await biliApi.resolveVideoUrl(bvid, {
            noDash,
            qn: wantQn,
            audioId: wantAudioId,
          })
        videoUrl = resolved.videoUrl
        dash = resolved.dash
        viewData = resolved.viewData
        playData = resolved.playData
        /**
         * 关键修复：这里必须**合并**而不是**替换**。
         *
         * 原来写的是 `targetVideo = { bvid, view_result, playurl_result }`，
         * 于是搜索结果条目里的 `title` / `pic` / `author` / `duration` 全被丢掉；
         * 而这个数组稍后会被写回搜索缓存（见下面的 selectedBvid 写回），
         * 下次 searchSong 拿到的这一项就没有标题和封面了 ——
         * 表现是播放器里视频标题空白、视频封面也回退不出来，
         * 并且会把 `title: ''` / `cover: null` 一起写进歌单的 videoCache。
         */
        targetVideo = {
          ...targetVideo,
          bvid,
          view_result: viewData,
          playurl_result: { ...playData, loginState: loggedIn, dashTried: !noDash },
        }
        if (targetIndex >= 0) results[targetIndex] = targetVideo
        else results.push(targetVideo)
      }

      // 补齐旧版本写坏的条目（缓存命中分支不会碰 title/pic，必须在这里回填）
      if (targetVideo) {
        targetVideo = backfillFromView(targetVideo)
        if (targetIndex >= 0) results[targetIndex] = targetVideo
      }

      // 有 keyword 时统一更新缓存（selectedBvid + 数据）
      if (keyword && cached) {
        const payload = cached.data as unknown as SearchPayload
        if (payload?.data) {
          payload.data.selectedBvid = bvid
          payload.data.result = results
        }
        if (cacheEnabled()) await cacheManager.save(keyword, cached.data)
      }

      /**
       * 顺手把「正在解析的这个视频」的标题 / 封面 / 清晰度回传。
       *
       * 渲染层靠它显示视频标题/封面，就不用依赖 `videoList` 里能否找到这个 bvid：
       * `selectedBvid` 是历史选择，完全可能不在本次搜索结果里，
       * 那时列表查不到，标题和封面就只能空着。
       *
       * 清晰度同理：只认 playurl 响应自己报的 `quality`
       * （请求里固定写的 qn=64 会被平台降级，不代表实际档位）。
       */
      const viewInfo = targetVideo?.view_result?.data
      const title =
        (typeof targetVideo?.title === 'string' && targetVideo.title) ||
        (typeof viewInfo?.title === 'string' ? viewInfo.title : null)
      const pic =
        typeof viewInfo?.pic === 'string' ? viewInfo.pic : (targetVideo?.pic ?? null)
      const quality = readVideoQuality(
        targetVideo?.playurl_result,
        // dash 时传视频轨地址，让清晰度取到「实际在播的那条流」
        videoUrl ?? dash?.videoUrl ?? null,
      )
      // 音质：dash 音频流的 id -> 展示名
      const playingAudioId = dash?.audioId ?? null
      const audioLabel =
        playingAudioId === null ? null : qualityLabelOf(AUDIO_QUALITY_OPTIONS, playingAudioId)
      const audioDesc =
        playingAudioId === null
          ? null
          : (findQualityOption(AUDIO_QUALITY_OPTIONS, playingAudioId)?.description ?? audioLabel)

      /**
       * 这个视频当前可选的清晰度 / 音质（给播放器上的切换菜单用）
       *
       * 注意它来自**缓存的 playurl 响应**：dash 响应里一次就带回所有可访问档位，
       * 所以手动切换清晰度不需要重新请求接口，直接换一条流即可。
       */
      const options = readQualityOptions(targetVideo?.playurl_result)


      return {
        videoUrl,
        dash,
        title,
        pic,
        quality: quality?.label ?? null,
        qualityDesc: quality?.description ?? null,
        audioQuality: audioLabel,
        audioQualityDesc: audioDesc,
        options,
      }
    } catch (err) {
      console.error('解析视频地址异常：', err)
      return { videoUrl: null, error: '视频地址解析失败' }
    }
  })
}
