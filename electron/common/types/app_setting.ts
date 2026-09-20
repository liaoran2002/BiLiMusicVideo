/**
 * AppSetting 全局类型声明
 *
 * 采用 LX Music 的「扁平 + 点号分隔」键名风格（如 'player.volume'），
 * 这样 mergeSetting 只需要做一层浅合并即可完成「默认值 + 用户值」的合并，
 * 并且能精确算出到底哪些 key 被改动了，便于向渲染进程精确广播。
 *
 * 该文件是纯类型声明，主进程与渲染进程都会引用，保证两边共用同一套类型。
 */

/** 点号扁平键名：'player.volume' -> { player: { volume: number } } */
export type FlatKeyToNested<T> = {
  [K in keyof T & string as K extends `${infer H}.${string}` ? H : never]: T[K]
}

/** 同步时重复歌曲的处理方式 */
export type DuplicatePolicy = 'keep' | 'dedupe'

export interface AppSetting {
  /** 配置结构版本号，用于迁移判定 */
  version: string

  // #region common
  /** 是否以桌面壁纸模式启动（等价于命令行 --wallpaper-mode） */
  'common.wallpaperMode': boolean
  /** 启动时是否自动播放 */
  'common.startupAutoPlay': boolean
  /** 窗口记忆的尺寸 id（后续可扩展多档窗口尺寸） */
  'common.windowSizeId': number
  // #endregion

  // #region player
  /** 音量大小 0 - 100 */
  'player.volume': number
  /** 是否静音 */
  'player.isMute': boolean
  /** 切歌模式 */
  'player.loopMode': (typeof import('../constants').PLAY_LOOP_MODES)[number]
  /** 启动软件时是否恢复上次播放的歌曲下标 */
  'player.isSavePlayIndex': boolean
  /** 上次播放到第几首 */
  'player.playIndex': number
  /** 启动时自动续播上次的歌单 / 歌曲 / 进度 */
  'player.resumeOnStart': boolean
  /** 续播时是否连播放进度（秒）一起恢复；关闭则从该曲开头播放 */
  'player.resumePlaybackTime': boolean
  /** 上次播放到的秒数（用于续播） */
  'player.resumeTime': number
  /** 默认视频清晰度（B 站 qn 档位代码，如 116 = 1080P 60帧） */
  'player.videoQuality': number
  /** 默认音质（dash 音频流 id，如 30280 = 192K） */
  'player.audioQuality': number
  /**
   * 标题关键词加权配置：score -> 关键词列表
   *
   * 正分关键词命中则加分（越优先），负分关键词命中则降权（如翻唱、伴奏、教学）。
   * 该字段是一个整体替换的配置对象，不做逐项深合并。
   */
  'player.tagBonus': Record<string, string[]>
  // #endregion

  // #region cache
  /** 是否启用搜索缓存 */
  'cache.enable': boolean
  /** 缓存最长有效时间（毫秒），超过则视为过期 */
  'cache.maxAge': number
  // #endregion
}
