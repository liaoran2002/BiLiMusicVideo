/**
 * 渲染进程侧的类型化 IPC 包装
 *
 * 参考 LX Music 的 src/common/rendererIpc.ts
 *
 * 注意：这个文件只被 preload 引用。
 * 在 contextIsolation 开启（默认且本项目不做简化）的前提下，
 * 渲染进程页面本身拿不到 ipcRenderer，只能通过 preload 暴露的 api。
 */
import { ipcRenderer } from 'electron'
import type {
  IpcChannel,
  IpcEvent,
  IpcEventPayload,
  IpcParams,
  IpcResult,
  RemoveListener,
} from './types/ipc'

/** 调用主进程 handler 并拿到类型化返回值 */
export async function rendererInvoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcParams<C> extends void ? [] : [IpcParams<C>]
): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

/** 监听主进程广播，返回取消监听函数 */
export function rendererOn<E extends IpcEvent>(
  event: E,
  listener: (payload: IpcEventPayload<E>) => void,
): RemoveListener {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    listener(payload as IpcEventPayload<E>)
  }
  ipcRenderer.on(event, handler)
  return () => {
    ipcRenderer.removeListener(event, handler)
  }
}
