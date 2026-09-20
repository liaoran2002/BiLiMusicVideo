/**
 * 通用工具方法（主 / 渲染进程共用）
 */

/**
 * 比较两个版本号
 *
 * @returns a > b 返回 1，a < b 返回 -1，相等返回 0
 */
export const compareVer = (a: string, b: string): number => {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/**
 * 生成防抖函数
 *
 * 参考 LX Music 的 src/common/utils/common.ts
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void | Promise<void>,
  delay = 100,
): ((...args: Args) => void) & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let _args: Args
  const wrapped = (...args: Args): void => {
    _args = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void fn(..._args)
    }, delay)
  }
  wrapped.flush = (): void => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    void fn(..._args)
  }
  wrapped.cancel = (): void => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }
  return wrapped
}
