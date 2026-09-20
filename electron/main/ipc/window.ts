/**
 * 窗口控制 IPC
 */
import { mainHandle } from '@common/mainIpc'
import type { IpcContext } from '../ipcHandlers'

export const registerWindowHandlers = (context: IpcContext): void => {
  mainHandle('win:minimize', () => {
    context.getMainWindow()?.minimize()
  })

  mainHandle('win:close', () => {
    context.getMainWindow()?.close()
  })

  mainHandle('win:maximize', () => {
    const win = context.getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  mainHandle('win:isMaximized', () => context.getMainWindow()?.isMaximized() ?? false)

  mainHandle('win:toggleFullscreen', () => {
    if (!context.getMainWindow()) return false
    context.toggleFullScreen()
    return context.isFullScreen()
  })

  // 注意：不能用 win.isFullScreen()。主窗口是 transparent，Windows 上
  // 透明窗口的原生全屏是失效的，全屏状态由主进程自己维护。
  mainHandle('win:isFullscreen', () => context.isFullScreen())

  mainHandle('win:startDrag', () => context.startWindowDrag())

  mainHandle('win:moveWindow', ({ x, y }) => {
    context.moveWindow(x, y)
  })

  mainHandle('win:getScreenWorkArea', () => context.getScreenWorkArea())
}
