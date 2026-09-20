/**
 * 歌单 IPC
 *
 * 新版：playlists:*（多歌单集合 + 同步）
 * 旧版：playlist:get / playlist:save 仅作兼容保留，新代码不应再使用。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { STORE_NAMES } from '@common/constants'
import { mainHandle } from '@common/mainIpc'
import type { Playlist } from '@common/types/ipc'
import {
  getPlaylists,
  savePlaylists,
  syncPlaylists,
} from '../utils/playlist'

const getLegacyPath = (): string =>
  path.join(app.getPath('userData'), `${STORE_NAMES.PLAYLIST}.json`)

const readJsonFile = <T>(filePath: string): T | null => {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

export const registerPlaylistHandlers = (): void => {
  // #region 新版：歌单集合
  mainHandle('playlists:get', () => getPlaylists())

  mainHandle('playlists:save', (params) => savePlaylists(params))

  mainHandle('playlists:sync', ({ ids }) => syncPlaylists(ids))
  // #endregion

  // #region 旧版兼容（只读；写入仍写旧文件，避免破坏别人对旧接口的假设）
  mainHandle('playlist:get', () => readJsonFile<Playlist>(getLegacyPath()))

  mainHandle('playlist:save', (data) => {
    fs.writeFileSync(getLegacyPath(), JSON.stringify(data, null, 2), 'utf-8')
    return true
  })
  // #endregion
}
