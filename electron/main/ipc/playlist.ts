/**
 * 歌单 IPC
 *
 * 只保留新版 `playlists:*`（多歌单集合 + 同步）。
 * 旧的单歌单接口 `playlist:get` / `playlist:save` 全项目没有任何调用方，
 * 已经删掉；旧的 `playlist.json` 只在启动时被 `utils/playlist.ts` 当迁移源读一次。
 */
import { mainHandle } from '@common/mainIpc'
import {
  getPlaylists,
  savePlaylists,
  syncPlaylists,
} from '../utils/playlist'

export const registerPlaylistHandlers = (): void => {
  mainHandle('playlists:get', () => getPlaylists())

  mainHandle('playlists:save', (params) => savePlaylists(params))

  mainHandle('playlists:sync', ({ ids }) => syncPlaylists(ids))
}
