/**
 * 渲染进程 API 出口
 *
 * 由于 preload 已经通过 contextBridge 暴露了**带类型**的 api，
 * 且 src/global.d.ts 扩展了 window，这里不再需要像迁移前那样手写一层无类型转发：
 *   const api = window.electronAPI; export default { xxx: () => api.xxx() }
 *
 * 直接透出 window.electronAPI，调用处自动获得完整 TS 提示。
 */
import type { RendererAPI } from '@common/types/api'

const api: RendererAPI = window.electronAPI

export default api
