/**
 * 托盘 IPC（含自绘菜单）
 */
import { mainHandle } from '@common/mainIpc'
import type { IpcContext } from '../ipcHandlers'

export const registerTrayHandlers = (context: IpcContext): void => {
  mainHandle('tray:updateState', (state) => {
    context.updateTrayState(state)
  })

  // 自绘托盘菜单：状态 / 动作 / 尺寸回报 / 收起
  mainHandle('trayMenu:getState', () => context.getTrayMenuState())
  mainHandle('trayMenu:action', (action) => {
    context.runTrayMenuAction(action)
  })
  mainHandle('trayMenu:ready', ({ height }) => {
    context.sizeTrayMenu(height)
  })
  mainHandle('trayMenu:close', () => {
    context.hideTrayMenu()
  })

  // 任务栏播放进度
  mainHandle('window:setProgress', ({ progress, paused }) => {
    context.setProgress(progress, paused)
  })
}
