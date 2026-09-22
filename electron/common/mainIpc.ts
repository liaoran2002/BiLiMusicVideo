/**
 * 主进程侧的类型化 IPC 包装
 *
 * 参考 LX Music 的 src/common/mainIpc.ts
 *
 * 作用：把 `ipcMain.handle(channel, (event, payload) => ...)` 收敛成
 * `mainHandle(channel, (payload) => ...)`，配合 types/ipc.ts 的 ChannelMap，
 * 让主进程注册 handler 时自动获得入参与返回值的类型检查。
 */
import { ipcMain, webContents as allWebContents } from 'electron'
import type { IpcChannel, IpcEvent, IpcEventPayload, IpcParams, IpcResult } from './types/ipc'

/**
 * 注册 invoke handler（渲染进程 -> 主进程，带返回值）
 *
 * 注意：如果 channel 的 params 是 void，则回调不接收参数。
 */
export function mainHandle<C extends IpcChannel>(
  channel: C,
  listener: (params: IpcParams<C>) => IpcResult<C> | Promise<IpcResult<C>>,
): void {
  ipcMain.handle(channel, (_event, params) => listener(params as IpcParams<C>))
}

/**
 * 向所有窗口广播
 *
 * 这是「多窗口同步」的关键：主进程更新配置后，把变化的部分
 * 广播给所有 webContents，渲染进程各自同步自己的 Pinia 副本。
 */
export const broadcast = <E extends IpcEvent>(event: E, payload: IpcEventPayload<E>): void => {
  for (const contents of allWebContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue
    contents.send(event, payload)
  }
}
