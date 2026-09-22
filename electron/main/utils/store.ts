/**
 * 简易 JSON 存储（原子写入）
 *
 * 参考 LX Music 的 src/main/utils/store.ts
 *
 * 关键点：写入采用「先写临时文件，再 rename 覆盖」的原子写法。
 * 直接 writeFileSync 到目标文件，如果在写入过程中断电/崩溃，
 * 会留下一个被截断的半个 JSON，下次启动就解析失败、配置全丢。
 * rename 在同一分区上是原子的，能保证要么是旧内容要么是新内容。
 */
import fs from 'node:fs'
import { writeJsonAtomic } from './atomicJson'

interface StoreOptions {
  /** 读取到非法 JSON 时是否清空重建（false 则抛错） */
  clearInvalidConfig?: boolean
}

export default class Store<T extends Record<string, unknown>> {
  private readonly filePath: string
  private data: Partial<T>

  constructor(filePath: string, options: StoreOptions = {}) {
    const { clearInvalidConfig = true } = options
    this.filePath = filePath
    this.data = this.read(clearInvalidConfig)
  }

  private read(clearInvalidConfig: boolean): Partial<T> {
    if (!fs.existsSync(this.filePath)) return {}

    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch {
      return {}
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('store root is not a plain object')
      }
      return parsed as Partial<T>
    } catch (err) {
      if (!clearInvalidConfig) throw err
      // 配置损坏：备份一份再从空对象重建，避免用户数据无声消失
      try {
        fs.renameSync(this.filePath, `${this.filePath}.${Date.now()}.bak`)
      } catch {
        /* 备份失败也不阻塞启动 */
      }
      console.error(`[store] invalid json, rebuilt: ${this.filePath}`)
      return {}
    }
  }

  /** 原子写入（temp + rename，实现见 utils/atomicJson.ts） */
  private writeFile(): void {
    writeJsonAtomic(this.filePath, this.data, '\t')
  }

  /** 读取值 */
  get<K extends keyof T>(key: K): T[K] | undefined {
    return this.data[key]
  }

  /** 整体覆盖并落盘 */
  override(value: Partial<T>): void {
    this.data = value
    this.writeFile()
  }
}

/** 同一个路径复用同一个 Store 实例，避免多份内存副本互相覆盖 */
const stores = new Map<string, Store<Record<string, unknown>>>()

/**
 * 取得（或创建）指定路径的 Store
 *
 * @param filePath 完整文件路径
 * @param clearInvalidConfig 读到非法 JSON 时是否清空重建，默认 true
 */
export const getStore = <T extends Record<string, unknown>>(
  filePath: string,
  clearInvalidConfig = true,
): Store<T> => {
  let store = stores.get(filePath)
  if (!store) {
    store = new Store<Record<string, unknown>>(filePath, { clearInvalidConfig })
    stores.set(filePath, store)
  }
  return store as unknown as Store<T>
}
