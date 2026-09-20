/**
 * 渲染进程全局类型
 *
 * 这里把 preload 暴露的 api 挂到 window 上。
 * 契约来自 @common/types/api（纯类型，不依赖 electron），
 * 因此渲染进程的 tsconfig 不需要引入 electron 类型也能正确推导，
 * window.electronAPI.xxx 全部有自动补全与返回值类型。
 */
import type { RendererAPI } from '@common/types/api'

declare global {
  interface Window {
    electronAPI: RendererAPI
  }
}

export {}
