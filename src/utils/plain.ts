/**
 * 把 Vue 响应式对象转成可结构化克隆的普通对象
 *
 * 为什么需要：Pinia/Vue 的 ref/reactive 都是 Proxy，
 * `structuredClone(proxy)` 会抛 DataCloneError（"could not be cloned"）。
 * 而 `toRaw()` **只解开最外层那一层**，嵌套的数组/对象仍然是 Proxy。
 *
 * 实测踩坑：把歌曲数组（响应式）塞进歌单后整体 structuredClone 会失败，
 * 报 `Failed to execute 'structuredClone' on 'Window': [object Array] could not be cloned`。
 *
 * 这里做一次深度解包，再交给调用方克隆。
 */
import { isRef, toRaw } from 'vue'

export const unwrapDeep = <T>(value: T): T => {
  // 先剥 ref
  let cur: unknown = isRef(value) ? value.value : value
  // 再剥 reactive
  cur = toRaw(cur as object)

  if (Array.isArray(cur)) {
    return cur.map((item) => unwrapDeep(item)) as unknown as T
  }
  if (cur && typeof cur === 'object') {
    // Date / RegExp 等非普通对象保持原样
    const proto = Object.getPrototypeOf(cur)
    if (proto !== Object.prototype && proto !== null) return cur as T
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(cur as Record<string, unknown>)) {
      out[key] = unwrapDeep((cur as Record<string, unknown>)[key])
    }
    return out as T
  }
  return cur as T
}

/**
 * 深度解包 + 深拷贝，得到一个可以安全跨 IPC / 落盘的普通对象
 */
export const toPlain = <T>(value: T): T => structuredClone(unwrapDeep(value))
