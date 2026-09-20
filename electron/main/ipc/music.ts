/**
 * 音乐歌单解析 IPC
 */
import { mainHandle } from '@common/mainIpc'
import { resolvePlaylist } from '../music'

export const registerMusicHandlers = (): void => {
  mainHandle('music:getPlaylistDetail', (params) => resolvePlaylist(params))
}
