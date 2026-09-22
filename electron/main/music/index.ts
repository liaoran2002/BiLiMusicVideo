/**
 * 音乐歌单解析入口（按音源分发）
 *
 * 对应 LX 的 src/renderer/utils/musicSdk/index.js 那张「总表」，
 * 但这里跑在主进程，并通过 IPC 暴露给渲染进程。
 *
 * 与 LX 的一个改进：LX 让用户在「打开歌单」弹窗里手选音源；
 * 本项目只有一个输入框，所以增加了**按分享链接的 host 自动识别音源**，
 * 识别不出来时才要求调用方显式指定。
 */
import type {
  GetPlaylistDetailParams,
  MusicSource,
  PlaylistDetail,
} from '@common/types/musicSdk'
import { MUSIC_SOURCE_NAMES } from '@common/types/musicSdk'
import { detectSource } from './utils'
import * as tx from './sources/tx'
import * as wy from './sources/wy'
import * as kw from './sources/kw'

/** 已接入的音源表 */
const SOURCES = {
  tx,
  wy,
  kw,
} as const

type SupportedSource = keyof typeof SOURCES

/** 当前支持自动/手动解析的音源列表 */
const SUPPORTED_SOURCES = Object.keys(SOURCES) as SupportedSource[]

export { detectSource }

/**
 * 判断音源是否已接入
 *
 * 酷狗(kg) 在类型里是合法音源，但本版本尚未移植其解析实现，
 * 这里显式挡掉，避免传入后抛「undefined is not a function」这种莫名错误。
 */
const isSupported = (source: MusicSource): source is SupportedSource =>
  source in SOURCES

/**
 * 解析歌单
 *
 * @param params.input  歌单分享链接或歌单 ID（网易云支持 `链接###token`）
 * @param params.source 不传则按链接 host 自动识别
 * @param params.page   页码，默认 1
 */
export const resolvePlaylist = async (
  params: GetPlaylistDetailParams,
): Promise<PlaylistDetail> => {
  const input = (params.input ?? '').trim()
  if (!input) throw new Error('歌单链接不能为空')

  let source = params.source
  if (!source) {
    const detected = detectSource(input)
    if (!detected) {
      // 纯数字 ID 无法判断属于哪个平台（各平台的数字 ID 都是纯数字）
      // 这与 LX 的行为一致：LX 也是让用户在弹窗里手选音源
      if (/^\d+$/.test(input)) {
        throw new Error(
          '只填数字 ID 无法判断是哪个音乐平台。请直接粘贴歌单的分享链接，或在链接后面带上平台信息',
        )
      }
      throw new Error(
        '无法识别这个链接属于哪个音乐平台。目前支持 网易云音乐 / QQ音乐 / 酷我音乐 的歌单分享链接',
      )
    }
    source = detected
  }

  if (!isSupported(source)) {
    const name = MUSIC_SOURCE_NAMES[source] ?? source
    throw new Error(
      `${name} 的歌单解析尚未接入（当前已支持：${SUPPORTED_SOURCES.map((s) => MUSIC_SOURCE_NAMES[s]).join(' / ')}）`,
    )
  }

  const page = params.page && params.page > 0 ? params.page : 1
  return SOURCES[source].getListDetail(input, page)
}
