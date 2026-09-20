/**
 * IPC 类型工具 —— 主 / 渲染进程共用
 *
 * 参考 LX Music 的 src/common/types/ipc_main.d.ts 与 ipc_renderer.d.ts
 *
 * 设计要点：
 * 1. 所有 invoke 统一走「单个 payload 对象」而不是多参数，
 *    这样主进程与渲染进程的类型签名能一一对应，避免参数顺序写错。
 * 2. 用一个 ChannelMap 集中描述「频道 -> (入参, 返回值)」，
 *    渲染进程侧的 api.updateSetting 就能自动拿到正确的参数与返回值类型，
 *    从而彻底消除手写 api 层的 any。
 */

// 方便调用方直接从本模块拿到配置类型
export type { AppSetting } from './app_setting'

/**
 * dash 双轨（主进程 -> 渲染层）
 *
 * dash 的视频和音频是两条独立的流，只给一条会没有声音，
 * 渲染层用 MSE 把它们合成到同一个 `<video>` 上。
 */
export interface DashStreamsPayload {
  videoUrl: string
  audioUrl: string
  /** SourceBuffer 的 MIME，例如 `video/mp4; codecs="avc1.640032"` */
  videoMime: string
  audioMime: string
  /** dash 总时长（秒）；分片 MP4 的 mvhd 常为 0，MSE 需要它补 MediaSource.duration */
  duration: number | null
  /** 视频轨清晰度代码，便于排查 */
  videoId: number | null
  /** 音频流 id（例如 30280），便于展示 / 切换 */
  audioId: number | null
}

/** 可选档位（清晰度 / 音质），主进程 -> 渲染层 */
export interface QualityOptionPayload {
  id: number
  label: string
  description: string
}

/** 某个视频当前可选的清晰度 / 音质 */
export interface QualityOptionsPayload {
  video: QualityOptionPayload[]
  audio: QualityOptionPayload[]
}

/** IPC 频道契约：channel -> { params, result } */
export interface IpcChannelMap {
  // #region setting（主进程接管配置）
  'setting:get': { params: void; result: import('./app_setting').AppSetting }
  'setting:update': {
    params: Partial<import('./app_setting').AppSetting>
    result: import('./app_setting').AppSetting
  }
  'setting:reset': { params: void; result: import('./app_setting').AppSetting }
  // #endregion

  // #region window
  'win:minimize': { params: void; result: void }
  'win:maximize': { params: void; result: void }
  'win:close': { params: void; result: void }
  'win:isMaximized': { params: void; result: boolean }
  'win:toggleFullscreen': { params: void; result: boolean }
  'win:isFullscreen': { params: void; result: boolean }
  'win:startDrag': { params: void; result: DragOffset | null }
  'win:moveWindow': { params: { x: number; y: number }; result: void }
  'win:getScreenWorkArea': { params: void; result: Electron.Rectangle | null }
  // #endregion

  // #region auth
  'auth:startLogin': { params: void; result: void }
  'auth:reLogin': { params: void; result: void }
  'auth:setLoggedIn': { params: { loggedIn: boolean }; result: void }
  'auth:executeLogout': { params: void; result: void }
  // #endregion

  // #region bilibili api
  'api:getUserInfo': { params: void; result: UserInfo }
  'api:searchSong': { params: { keyword: string }; result: { data: unknown } }
  'api:resolveVideo': {
    params: {
      bvid: string
      keyword?: string
      skipCache?: boolean
      /** 强制不用 dash（dash 播放失败后兜底成 durl 720P） */
      noDash?: boolean
      /** 指定清晰度（qn）；不传则用设置里的默认值 */
      qn?: number
      /** 指定音质（dash 音频流 id）；不传则用设置里的默认值 */
      audioId?: number
    }
    result: {
      /** durl（渐进式 mp4）地址；走 dash 时为 null */
      videoUrl: string | null
      /** dash 双轨（音视频分开，需要 MSE 合成）；走 durl 时为 null */
      dash?: DashStreamsPayload | null
      /** 正在解析的这个视频的标题（权威值，渲染层不必再去列表里找） */
      title?: string | null
      /** 正在解析的这个视频的封面 */
      pic?: string | null
      /** 正在解析的这个视频的清晰度短标签，例如 1080P / 4K */
      quality?: string | null
      /** 清晰度完整描述，例如 1080P 高清 / 1080P 60帧 */
      qualityDesc?: string | null
      /** 实际在播的音质短标签，例如 192K */
      audioQuality?: string | null
      /** 音质完整描述，例如 192K 高音质 */
      audioQualityDesc?: string | null
      /** 这个视频当前可选的清晰度 / 音质（用于播放器上的切换菜单） */
      options?: QualityOptionsPayload | null
      error?: string
    }
  }
  // #endregion

  // #region 音乐平台歌单解析（移植自 LX 的 musicSdk）
  'music:getPlaylistDetail': {
    params: import('./musicSdk').GetPlaylistDetailParams
    result: import('./musicSdk').PlaylistDetail
  }
  // #endregion

  // #region playlist
  /** @deprecated 旧版单歌单接口，保留兼容；新代码请用 playlists:* */
  'playlist:get': { params: void; result: Playlist | null }
  /** @deprecated 旧版单歌单接口 */
  'playlist:save': { params: Playlist; result: boolean }
  /** 读取歌单集合 */
  'playlists:get': { params: void; result: import('./playlist').PlaylistStoreData }
  /** 整体保存歌单集合（增删改后调用） */
  'playlists:save': {
    params: import('./playlist').PlaylistSaveParams
    result: import('./playlist').PlaylistStoreData
  }
  /** 同步指定歌单（重新解析曲目；重复歌曲由主进程固定去重） */
  'playlists:sync': {
    params: { ids: string[] }
    result: import('./playlist').SyncResult[]
  }
  // #endregion

  // #region cache
  'cache:clearAll': { params: void; result: boolean }
  'cache:clearSingle': { params: { keyword: string }; result: boolean }
  /** 缓存统计（文件数 / 占用字节） */
  'cache:getStats': {
    params: void
    result: import('./cache_stats').CacheStats
  }
  /** 手动触发一次过期清理 + LRU 淘汰 */
  'cache:prune': {
    params: void
    result: import('./cache_stats').CacheStats
  }
  // #endregion

  // #region wallpaper / tray
  'wallpaper:toggle': { params: void; result: boolean }
  'wallpaper:isEnabled': { params: void; result: boolean }
  'tray:updateState': { params: TrayState; result: void }
  // #endregion
}

/** 可从 ChannelMap 推导出的合法频道名 */
export type IpcChannel = keyof IpcChannelMap

/** 取某频道的入参类型 */
export type IpcParams<C extends IpcChannel> = IpcChannelMap[C]['params']
/** 取某频道的返回值类型 */
export type IpcResult<C extends IpcChannel> = IpcChannelMap[C]['result']

/**
 * 主进程 -> 渲染进程的广播频道契约
 */
export interface IpcEventMap {
  /** 配置更新广播（多窗口同步的核心） */
  'setting:update': Partial<import('./app_setting').AppSetting>
  'auth:logout': void
  'auth:loginSuccess': void
  'tray:playControl': void
  'tray:prev': void
  'tray:next': void
  'tray:toggleMode': void
  'tray:showPlaylist': void
  'tray:showLogoutConfirm': void
  'wallpaper:state': boolean
  'window:maximized': boolean
  'window:fullscreen': boolean
}

export type IpcEvent = keyof IpcEventMap
export type IpcEventPayload<E extends IpcEvent> = IpcEventMap[E]

/** 取消监听函数 */
export type RemoveListener = () => void

export interface DragOffset {
  offsetX: number
  offsetY: number
}

export interface UserInfo {
  face: string
  name: string
}

/**
 * 歌单里的一项
 *
 * 本项目的歌单由「音乐平台歌单解析」（electron/main/music）产出，
 * 统一转换成 `"歌名-歌手"` 字符串，再交给 B 站搜索。
 * B 站搜索出来的视频项是对象形状，用 BiliVideo（见 renderer 侧 types/app.ts）。
 */
export type PlaylistSong = string

export interface Playlist {
  name: string
  songs: PlaylistSong[]
}

/** 兼容保留：极少数情况下需要服务端返回结构化的 {name, songs} */
export interface SongList {
  name?: string
  songs?: PlaylistSong[]
}

export interface TrayState {
  paused?: boolean
  /** 当前循环模式（字符串枚举，见 PLAY_LOOP_MODES） */
  loopMode?: string
}
