/**
 * App.vue 的本地数据类型定义
 *
 * 抽到独立文件是为了：
 *  1. 让 <script lang="ts"> 里的 data() 有明确类型，模板里 this.xxx 能被检查
 *  2. 避免把 90 多行类型定义塞进 SFC
 *  3. 配置相关的类型（AppSetting）来自主 / 渲染共用的 electron/common
 */
import type { PlaylistSong, RemoveListener, UserInfo } from '@common/types/ipc'
import type { DashStreamsPayload, QualityOptionsPayload } from '@common/types/ipc'
import type { DashSession } from '../utils/dashPlayer'
import type { PlaylistSong as StructuredSong } from '@common/types/playlist'

/** 循环模式下标（与 electron/common 的 PLAY_LOOP_MODES 顺序一致） */
export interface LoopModeIndex {
  read: 0
  single: 1
  random: 2
}

/** 列表弹层类型：none 关闭 / list 歌单 / vList 视频列表 */
export type ListType = 'none' | 'list' | 'vList'

/** biliVideoControls 派发的控制动作 */
export type VideoControlAction =
  | 'list'
  | 'vList'
  | 'before'
  | 'playControls'
  | 'next'
  | 'playMode'

/**
 * B 站搜索结果里的视频项
 *
 * 与 showList 的 VideoListItem 保持结构兼容（bvid/title/pic/author/duration）。
 */
export interface BiliVideo {
  bvid: string
  title: string
  /** B 站缩略图 */
  pic?: string | null
  /** UP 主 */
  author?: string | null
  /** 时长（秒） */
  duration?: number | null
  /** 后端缓存里可能带上这两个字段 */
  view_result?: unknown
  playurl_result?: unknown
}

export interface AppData {
  // ---- 歌单与播放 ----
  /** 当前歌单的曲目（结构化：含封面 / 专辑 / 歌手） */
  songs: StructuredSong[]
  videoList: BiliVideo[]
  /** `videoList` 属于哪一首歌（搜索键），用于判断列表是否已经跟上当前歌曲 */
  videoListKeyword: string
  /** 正在播的那个视频的封面（主进程回传，优先于列表里的缩略图） */
  videoPic: string
  /** 正在播的视频清晰度短标签（取自 playurl 响应报的档位），例如 1080P */
  videoQuality: string
  /** 清晰度完整描述，例如 1080P 高清 / 1080P 60帧 */
  videoQualityDesc: string
  /** `<video>` 实际解码出的分辨率，例如 1920×1080，仅用于悬浮提示交叉印证 */
  videoQualityPixels: string
  /** 正在播的音频流音质短标签（playurl 响应报的档位），例如 192K */
  audioQuality: string
  /** 音质完整描述，例如 192K 高音质 */
  audioQualityDesc: string
  /** 这个视频当前可选的清晰度 / 音质（播放器上的切换菜单用） */
  qualityOptions: QualityOptionsPayload | null
  /** 本次会话手动选过的清晰度（null 表示用设置里的默认值） */
  selectedQn: number | null
  /** 本次会话手动选过的音质（null 表示用设置里的默认值） */
  selectedAudioId: number | null
  videoUrl: string
  /** dash 双轨信息（非空时用 MSE 播放；只有 durl 时为空） */
  dashSource: DashStreamsPayload | null
  /** 当前 dash 会话（MSE），不进模板所以不需要响应式 */
  _dashSession: DashSession | null
  /** dash 连续失败次数 */
  _dashFailures: number
  /** 本会话是否已判定 dash 不可用（连续失败后置位，避免每首歌都白试一次） */
  _dashDisabled: boolean
  /** 正在播的视频 bvid（`currentVideoIndex` 可能是 -1，所以单独记一个） */
  currentBvid: string
  randomList: number[]
  currentIndex: number
  currentVideoIndex: number
  MODE: LoopModeIndex
  currentMode: number
  videoName: string
  songName: string
  listName: string
  currentVolume: number
  currentTime: number
  duration: number
  isMuted: boolean
  paused: boolean
  listType: ListType

  // ---- 歌单管理弹窗 ----
  /** 统一的歌单管理弹窗（新建/编辑/同步/曲目浏览都在里面） */
  playlistManagerVisible: boolean

  // ---- 窗口状态 ----
  isMaximized: boolean
  isFullscreen: boolean
  wallpaperEnabled: boolean

  // ---- 窗口拖拽 ----
  isDragging: boolean
  dragStarted: boolean
  dragReady: boolean
  dragStartX: number
  dragStartY: number
  dragOffsetX: number
  dragOffsetY: number
  _pendingMoveX: number
  _pendingMoveY: number
  _moveFramePending: boolean

  // ---- 请求竞态令牌 ----
  _songToken: number

  // ---- 登录态 ----
  isLoggedIn: boolean
  userFace: string
  userName: string

  // ---- 事件监听取消函数 ----
  removeMaximizedListener: RemoveListener | null
  removeFullscreenListener: RemoveListener | null
  removeLoginListener: RemoveListener | null
  removeLogoutListener: RemoveListener | null
  removeTrayPlayControl: RemoveListener | null
  removeTrayPrev: RemoveListener | null
  removeTrayNext: RemoveListener | null
  removeTrayToggleMode: RemoveListener | null
  removeTrayShowPlaylist: RemoveListener | null
  removeTrayShowLogoutConfirm: RemoveListener | null
  removeWallpaperState: RemoveListener | null

  /** 最后一个非零音量，用于「解除静音」时恢复 */
  lastNonZeroVolume: number

  // ---- 歌单 / 续播 ----
  /** 设置弹窗是否可见 */
  settingsVisible: boolean
  /** 视频请求竞态令牌（切视频时防乱序覆盖） */
  _videoToken: number
  /** 同一个视频的连续失败次数，达到上限就跳过该曲，避免无限重试 */
  _videoErrorCount: number
  /** 视频加载完成后要跳转到的秒数（续播用） */
  seekAfterLoad: number
  /** 上次写入播放进度的时间戳（节流用） */
  _lastPersistAt: number
  /** 上次同步 SMTC 进度的时间戳（节流用） */
  _lastMediaPosAt: number
  /** 定时自动同步的定时器 */
  _syncTimer: ReturnType<typeof setInterval> | null
}

export type { PlaylistSong, UserInfo }

/**
 * 模板里 <video ref="video"> 的最小接口
 *
 * 只声明本项目真正用到的成员，避免到处 (this.$refs.video as HTMLVideoElement)，
 * 也避免把整个 HTMLVideoElement 的庞杂类型引进来。
 */
export interface VideoElement {
  /** durl 播放时由 applyVideoSource 赋值；dash 播放时是 MediaSource 的 blob 地址 */
  src: string
  /** MSE 缓冲区裁剪时要用 */
  readonly buffered: TimeRanges
  volume: number
  muted: boolean
  currentTime: number
  readonly duration: number
  /** 实际解码出的画面尺寸（分辨率），用于印证清晰度 */
  readonly videoWidth: number
  readonly videoHeight: number
  play(): Promise<void>
  pause(): void
}
