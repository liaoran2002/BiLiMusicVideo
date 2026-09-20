/**
 * electron/common 出口
 *
 * 主进程与渲染进程都从这里导入，保证共用同一套类型与工具。
 */
export * from './constants'
export * from './ipcNames'
export * from './types/ipc'
export { default as defaultSetting } from './defaultSetting'
export { default as migrateSetting } from './utils/migrateSetting'
export { mergeSetting } from './utils/mergeSetting'
export { compareVer, debounce } from './utils/common'
export type { AppSetting } from './types/app_setting'
export type { RendererAPI, ScreenWorkArea } from './types/api'
export type { MergeSettingResult } from './utils/mergeSetting'
