/**
 * 主进程 / 渲染进程共用的常量
 *
 * 参考 LX Music (lyswhut/lx-music-desktop) 的 src/common/constants.ts
 */

/**
 * 配置数据结构版本号
 *
 * 注意：这里不是应用版本号（package.json 的 version），
 * 而是 setting.json 里 `version` 字段的版本。
 * 每当 AppSetting 的结构发生不兼容变更时，都需要 +1，
 * 并在 migrateSetting.ts 中补上对应的迁移逻辑。
 */
export const SETTING_VERSION = '1.0.0'

/** setting.json 中 version 字段低于此版本的数据需要迁移 */
export const MIN_SUPPORT_SETTING_VERSION = '1.0.0'

/** 应用数据目录（userData）下的文件名 */
export const STORE_NAMES = {
  APP_SETTINGS: 'setting',
  /** 旧版单歌单文件（会被迁移） */
  PLAYLIST: 'playlist',
  /** 新版歌单集合 */
  PLAYLISTS: 'playlists',
} as const

/** 播放循环模式：列表循环 / 单曲循环 / 随机播放 */
export const PLAY_LOOP_MODES = ['listLoop', 'singleLoop', 'random'] as const

/** 歌单集合数据的版本号（playlists.json 里的 version 字段） */
export const PLAYLIST_DATA_VERSION = '1.0.0'

/**
 * 可选定时同步间隔（毫秒）
 *
 * 界面上以下拉框展示，避免让用户自己填毫秒数。
 */
export const SYNC_INTERVAL_OPTIONS = [
  { label: '每 30 分钟', value: 30 * 60 * 1000 },
  { label: '每 1 小时', value: 60 * 60 * 1000 },
  { label: '每 3 小时', value: 3 * 60 * 60 * 1000 },
  { label: '每 6 小时', value: 6 * 60 * 60 * 1000 },
  { label: '每 12 小时', value: 12 * 60 * 60 * 1000 },
  { label: '每天', value: 24 * 60 * 60 * 1000 },
  { label: '每 3 天', value: 3 * 24 * 60 * 60 * 1000 },
  { label: '每周', value: 7 * 24 * 60 * 60 * 1000 },
] as const

/** 默认音源显示名（与 musicSdk 的 MusicSource 对应，单独放一份避免循环依赖） */
export const SOURCE_LABELS: Record<string, string> = {
  wy: '网易云',
  tx: 'QQ音乐',
  kw: '酷我',
  kg: '酷狗',
}

/**
 * 迁移用：v1.0.0 之前（旧版 App.vue 硬编码）的播放模式为数字 0/1/2
 */
export const LEGACY_PLAY_MODE_MAP = {
  0: 'listLoop',
  1: 'singleLoop',
  2: 'random',
} as const

/** 可选清晰度 / 音质（设置界面与播放器菜单共用） */
export interface QualityOption {
  /** B 站档位代码：视频是 qn，音频是 dash 音频流 id */
  id: number
  /** 短标签，用于角标 */
  label: string
  /** 完整说明，用于菜单 / 悬浮提示 */
  description: string
}

/**
 * 视频清晰度档位表（qn）
 *
 * 只用于**设置里的默认值**和兜底展示；实际可选档位由 playurl 响应的
 * `support_formats` / `accept_quality` 给出（不同视频和账号不一样）。
 */
export const VIDEO_QUALITY_OPTIONS: readonly QualityOption[] = [
  { id: 127, label: '8K', description: '8K 超高清' },
  { id: 126, label: '杜比视界', description: '杜比视界' },
  { id: 125, label: 'HDR', description: 'HDR 真彩' },
  { id: 120, label: '4K', description: '4K 超清' },
  { id: 116, label: '1080P60', description: '1080P 60帧' },
  { id: 112, label: '1080P+', description: '1080P 高码率' },
  { id: 80, label: '1080P', description: '1080P 高清' },
  { id: 74, label: '720P60', description: '720P 60帧' },
  { id: 64, label: '720P', description: '720P 准高清' },
  { id: 32, label: '480P', description: '480P 清晰' },
  { id: 16, label: '360P', description: '360P 流畅' },
  { id: 6, label: '240P', description: '240P 极速' },
]

/**
 * 音质档位表（dash `audio[].id`）
 *
 * B 站的音频流 id 是固定的一组，带宽决定音质；
 * 具体哪些可用同样由响应里的 `dash.audio` 决定。
 */
export const AUDIO_QUALITY_OPTIONS: readonly QualityOption[] = [
  { id: 30280, label: '192K', description: '192K 高音质' },
  { id: 30232, label: '132K', description: '132K 标准' },
  { id: 30216, label: '64K', description: '64K 流畅' },
]

/** 默认清晰度：1080P 60帧 */
export const DEFAULT_VIDEO_QN = 116
/** 默认音质：192K */
export const DEFAULT_AUDIO_ID = 30280

/** 按 id 取档位（查不到返回 undefined） */
export const findQualityOption = (
  list: readonly QualityOption[],
  id: number,
): QualityOption | undefined => list.find((o) => o.id === id)

/** 按 id 取短标签；查不到就退回数字，避免角标空着 */
export const qualityLabelOf = (list: readonly QualityOption[], id: number): string =>
  findQualityOption(list, id)?.label ?? String(id)
