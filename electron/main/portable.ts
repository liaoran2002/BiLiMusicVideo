/**
 * 便携模式（portable）
 *
 * 参考 LX Music 的 src/main/app.ts 里的 setUserDataPath
 *
 * 必须在**最早期**调用（app.whenReady 之前，越早越好），
 * 因为 app.getPath('userData') 一旦被读取就可能被缓存，
 * 之后再改 userData 会导致配置/缓存写到两个不同的地方。
 *
 * 规则：Windows 下若 exe 同级存在 `portable` 目录，
 * 则把 appData / userData 都指到 `portable/userData`。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** 当前是否处于便携模式 */
let portable = false

/** 取得便携模式目录（exe 同级的 portable） */
const getPortableDir = (): string => path.join(path.dirname(app.getPath('exe')), 'portable')

export const isPortable = (): boolean => portable

/**
 * 初始化 userData 路径
 *
 * @returns 最终的 userData 路径
 */
export const setupUserDataPath = (): string => {
  if (process.platform === 'win32') {
    const portableDir = getPortableDir()
    try {
      if (fs.existsSync(portableDir) && fs.statSync(portableDir).isDirectory()) {
        const userDataDir = path.join(portableDir, 'userData')
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true })
        // 同时改 appData，避免 electron 内部把一部分数据写到 Roaming
        app.setPath('appData', portableDir)
        app.setPath('userData', userDataDir)
        portable = true
      }
    } catch (err) {
      // 便携目录不可用时静默回退到默认 userData，不能因为这里抛错导致应用起不来
      console.error('[portable] setup failed, fallback to default userData:', err)
      portable = false
    }
  }

  const userDataPath = app.getPath('userData')
  // 确保目录存在：playlist.json / setting.json / search-cache 都写在这里
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true })
  return userDataPath
}
