/**
 * 缓存统计类型（主 / 渲染共用）
 */
export interface CacheStats {
  /** 缓存文件数 */
  count: number
  /** 占用字节数 */
  bytes: number
}
