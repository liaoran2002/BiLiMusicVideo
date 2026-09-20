/**
 * preload 暴露到渲染进程的全局类型
 *
 * 契约统一放在 @common/types/api，这里只做 window 的扩展声明，
 * 供 preload 自身编译时使用（渲染进程用的是 src/global.d.ts）。
 */
import type { RendererAPI } from '@common/types/api'

declare global {
  interface Window {
    electronAPI: RendererAPI
  }
}

export {}
