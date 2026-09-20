/**
 * 壁纸模式 IPC
 */
import { mainHandle } from '@common/mainIpc'
import type { IpcContext } from '../ipcHandlers'

export const registerWallpaperHandlers = (context: IpcContext): void => {
  mainHandle('wallpaper:toggle', () => context.toggleWallpaper())
  mainHandle('wallpaper:isEnabled', () => context.isWallpaperEnabled())
}
