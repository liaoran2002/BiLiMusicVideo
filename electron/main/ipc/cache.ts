/**
 * 缓存 IPC
 */
import { mainHandle } from '@common/mainIpc'
import type * as cacheManager from '../utils/cache'

interface CacheContext {
  cacheManager: typeof cacheManager
}

export const registerCacheHandlers = (context: CacheContext): void => {
  mainHandle('cache:clearAll', () => context.cacheManager.clearAll())
  mainHandle('cache:getStats', () => context.cacheManager.getStats())
  mainHandle('cache:prune', () => context.cacheManager.prune())
}
