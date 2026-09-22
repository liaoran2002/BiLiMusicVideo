/**
 * 应用级杂项 IPC
 */
import { shell } from 'electron'
import { mainHandle } from '@common/mainIpc'

/**
 * 只放行 http / https
 *
 * 这个通道的入参来自渲染进程，等于半个「执行外部命令」的口子，
 * 所以绝不能让 `file:` / `javascript:` / 自定义协议过去。
 */
const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export const registerAppHandlers = (): void => {
  mainHandle('app:openExternal', async ({ url }) => {
    if (typeof url !== 'string' || !isSafeUrl(url)) {
      console.warn('[app] 拒绝打开不安全的链接:', url)
      return false
    }
    await shell.openExternal(url)
    return true
  })
}
