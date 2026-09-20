/**
 * 配置 store（渲染进程）
 *
 * 核心思想（与 LX 一致）：
 *   Pinia **不负责持久化**，只做渲染进程的一份响应式副本。
 *
 * 数据流：
 *   页面加载   -> api.getSetting()          -> 填充 store
 *   用户改表单 -> api.updateSetting(partial) -> 主进程落盘
 *   主进程广播 -> 'setting:update'           -> 自动同步 store
 *
 * 注意：updateSetting 之后不要自己再赋值！主进程会广播回来，
 * 统一由广播路径写入 store，保证「单一数据源」，也天然支持多窗口同步。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api/electron'
import defaultSetting from '@common/defaultSetting'
import { mergeSetting } from '@common/utils/mergeSetting'
import { toPlain } from '@/utils/plain'
import type { AppSetting } from '@common/types/app_setting'

/**
 * 生成「可结构化克隆」的普通对象副本
 *
 * 踩坑记录：store 里的 state 是 Vue 的响应式 Proxy，
 * 直接 structuredClone(state) 会抛
 *   "Failed to execute 'structuredClone': #<Object> could not be cloned"
 * 而 `toRaw` 只解开最外层，嵌套的数组/对象仍是 Proxy（例如 player.tagBonus）。
 * 所以统一用 utils/plain 里的深度解包版本。
 */

export const useSettingStore = defineStore('setting', () => {
  /** 当前完整配置（响应式副本） */
  const setting = ref<AppSetting>(structuredClone(defaultSetting))
  /** 是否已完成首次拉取 */
  const loaded = ref(false)
  /** 是否正在与主进程通信（避免并发重复请求） */
  let loadingPromise: Promise<void> | null = null

  /**
   * 用局部配置合并进本地副本
   *
   * 复用主进程同一套 mergeSetting，保证两端合并语义完全一致。
   * 这里必须传深拷贝，否则 mergeSetting 的引用相等判断会漏掉
   * 嵌套对象（如 player.tagBonus）的更新。
   */
  const applyPartial = (partial: Partial<AppSetting>): void => {
    const current = toPlain(setting.value)
    const { setting: merged, updatedSettingKeys } = mergeSetting(current, partial)
    if (updatedSettingKeys.length === 0) return
    setting.value = merged
  }

  /** 从主进程拉取完整配置 */
  const load = async (): Promise<void> => {
    const data = await api.getSetting()
    setting.value = toPlain(data)
    loaded.value = true
  }

  /**
   * 确保已加载（幂等）
   * 并发调用时复用同一个请求，避免多个组件重复拉取
   */
  const ensureLoaded = async (): Promise<void> => {
    if (loaded.value) return
    loadingPromise ??= load().finally(() => {
      loadingPromise = null
    })
    await loadingPromise
  }

  /**
   * 更新配置（局部）
   *
   * 只把变化的部分发给主进程；本地副本由主进程广播统一回写。
   * 注意先 toPlain：调用方传进来的可能是响应式对象/ref，
   * 而 IPC 的结构化克隆不能处理 Proxy，会直接抛错。
   */
  const update = async (partial: Partial<AppSetting>): Promise<void> => {
    await api.updateSetting(toPlain(partial))
  }

  /** 恢复默认配置 */
  const reset = async (): Promise<void> => {
    setting.value = await api.resetSetting()
  }

  /**
   * 监听主进程广播并同步本地副本
   *
   * @returns 取消监听函数（组件卸载时调用）
   */
  const startSync = (): (() => void) => {
    return api.onSettingUpdate((partial) => {
      applyPartial(partial)
    })
  }

  // #region 便捷 getter / setter（让组件不用到处写魔法字符串）
  const volume = computed({
    get: () => setting.value['player.volume'],
    set: (value: number) => {
      void update({ 'player.volume': Math.min(100, Math.max(0, Math.round(value))) })
    },
  })

  const isMute = computed({
    get: () => setting.value['player.isMute'],
    set: (value: boolean) => {
      void update({ 'player.isMute': value })
    },
  })

  const loopMode = computed({
    get: () => setting.value['player.loopMode'],
    set: (value: AppSetting['player.loopMode']) => {
      void update({ 'player.loopMode': value })
    },
  })

  const tagBonus = computed(() => setting.value['player.tagBonus'])

  const playIndex = computed({
    get: () => setting.value['player.playIndex'],
    set: (value: number) => {
      void update({ 'player.playIndex': value })
    },
  })

  const wallpaperMode = computed({
    get: () => setting.value['common.wallpaperMode'],
    set: (value: boolean) => {
      void update({ 'common.wallpaperMode': value })
    },
  })
  // #endregion

  return {
    setting,
    loaded,
    volume,
    isMute,
    loopMode,
    tagBonus,
    playIndex,
    wallpaperMode,
    load,
    ensureLoaded,
    update,
    reset,
    startSync,
    applyPartial,
  }
})
