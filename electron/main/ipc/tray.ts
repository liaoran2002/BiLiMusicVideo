/**
 * 托盘状态 IPC
 */
import { mainHandle } from '@common/mainIpc'
import type { IpcContext } from '../ipcHandlers'

export const registerTrayHandlers = (context: IpcContext): void => {
  mainHandle('tray:updateState', (state) => {
    context.updateTrayState(state)
  })
}
