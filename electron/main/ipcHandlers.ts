/**
 * IPC 注册总入口
 *
 * 把各个领域的 handler 分开注册，主入口只负责组装依赖，
 * 避免像原来那样把所有 ipcMain.handle 堆在一个文件里。
 */
import * as biliApi from './biliApi'
import * as cacheManager from './utils/cache'
import { registerSettingHandlers } from './ipc/setting'
import { registerWindowHandlers } from './ipc/window'
import { registerAuthHandlers } from './ipc/auth'
import { registerApiHandlers } from './ipc/biliApiHandlers'
import { registerPlaylistHandlers } from './ipc/playlist'
import { registerCacheHandlers } from './ipc/cache'
import { registerMusicHandlers } from './ipc/music'
import { registerWallpaperHandlers } from './ipc/wallpaper'
import { registerTrayHandlers } from './ipc/tray'

export interface IpcContext {
  /** 取主窗口（可能尚未创建或被销毁） */
  getMainWindow: () => import('electron').BrowserWindow | null
  /** 打开登录窗口 */
  createLoginWindow: () => void
  /** 切换全屏，返回切换后的状态 */
  toggleFullScreen: () => Promise<void> | void
  /** 当前是否全屏 */
  isFullScreen: () => boolean
  /** 切换壁纸模式，返回切换后的状态（内部需要等窗口几何就绪） */
  toggleWallpaper: () => Promise<boolean>
  /** 当前是否处于壁纸模式 */
  isWallpaperEnabled: () => boolean
  /** 主窗口拖拽开始，返回鼠标相对窗口的偏移 */
  startWindowDrag: () => { offsetX: number; offsetY: number } | null
  /** 移动主窗口 */
  moveWindow: (x: number, y: number) => void
  /** 取主窗口所在显示器的可用区域 */
  getScreenWorkArea: () => Electron.Rectangle | null
  /** 设置登录状态（影响托盘菜单） */
  setLoggedIn: (loggedIn: boolean) => void
  /** 更新托盘播放状态 */
  updateTrayState: (state: { paused?: boolean; loopMode?: string }) => void
  /** 执行退出登录（清 cookie） */
  executeLogout: () => Promise<void>
  /** 应用退出 */
  quitApp: () => void
}

export const registerIpcHandlers = (context: IpcContext): void => {
  // 配置相关（本次改造新增的核心部分）
  registerSettingHandlers()

  // 窗口控制
  registerWindowHandlers(context)

  // 登录 / 登出
  registerAuthHandlers(context)

  // B 站接口
  registerApiHandlers({ biliApi, cacheManager })

  // 歌单
  registerPlaylistHandlers()

  // 音乐平台歌单解析（移植自 LX 的 musicSdk）
  registerMusicHandlers()

  // 缓存
  registerCacheHandlers({ cacheManager })

  // 壁纸
  registerWallpaperHandlers(context)

  // 托盘状态
  registerTrayHandlers(context)
}
