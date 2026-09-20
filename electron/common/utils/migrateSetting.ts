/**
 * 配置版本迁移
 *
 * 参考 LX Music 的 src/common/utils/migrateSetting.ts
 *
 * 核心思想：
 *  - 磁盘上的旧配置结构可能是任意形状，所以入参是 `unknown`（老数据不可信）
 *  - 按「版本闸门」逐级向上迁移：每段代码只负责把 version 从 A 抬到 B，
 *    执行完就把 setting.version 设为 B，天然幂等，重复执行也不会出错
 *  - 最终返回 Partial<AppSetting>，由 mergeSetting 与 defaultSetting 合并补全
 *
 * 由于本项目的配置此前从未落盘（旧版 App.vue 里的 currentVolume /
 * currentMode / tagBonusConfig 都是硬编码常量），所以这里没有真实的历史数据要迁移。
 * 下面给出的是可直接使用的迁移骨架与一个示例迁移，后续改结构时照此追加即可。
 */
import { SETTING_VERSION, LEGACY_PLAY_MODE_MAP } from '../constants'
import { compareVer } from './common'

/** 旧版（可能是任意形状）的配置对象 */
type LegacySetting = Record<string, unknown>

export default (setting: unknown): Partial<import('../types/app_setting').AppSetting> => {
  const input: LegacySetting =
    setting != null && typeof setting === 'object' && !Array.isArray(setting)
      ? { ...(setting as LegacySetting) }
      : {}

  // 没有 version 字段的老数据一律视为 0.0.0，从最早期开始迁移
  const rawVersion = input.version
  let version =
    typeof rawVersion === 'string' && rawVersion.trim() !== ''
      ? rawVersion.trim()
      : '0.0.0'

  if (compareVer(version, SETTING_VERSION) >= 0) {
    return input as Partial<import('../types/app_setting').AppSetting>
  }

  // #region 迁移至 v1.0.0
  // 示例迁移：早期「嵌套结构 + 数字枚举」的配置 -> 扁平点号键 + 字符串枚举
  if (compareVer(version, '1.0.0') < 0) {
    // 1. 嵌套结构 -> 扁平键
    //    旧: { player: { volume: 70, mode: 0 } }
    //    新: { 'player.volume': 70, 'player.loopMode': 'listLoop' }
    const oldPlayer = input.player as LegacySetting | undefined
    if (oldPlayer && typeof oldPlayer === 'object') {
      if (typeof oldPlayer.volume === 'number') input['player.volume'] = oldPlayer.volume
      if (typeof oldPlayer.isMute === 'boolean') input['player.isMute'] = oldPlayer.isMute
      if (oldPlayer.mode != null) input['player.loopMode'] = oldPlayer.mode
      delete input.player
    }

    // 2. 数字枚举 -> 字符串枚举
    const loopMode = input['player.loopMode']
    if (typeof loopMode === 'number') {
      input['player.loopMode'] =
        LEGACY_PLAY_MODE_MAP[loopMode as keyof typeof LEGACY_PLAY_MODE_MAP] ?? 'listLoop'
    }

    // 3. 修正历史拼写错误示例
    if (input['player.isMuted'] != null) {
      input['player.isMute'] = input['player.isMuted']
      delete input['player.isMuted']
    }

    version = '1.0.0'
  }
  // #endregion

  // 后续版本迁移照此追加，例如：
  // if (compareVer(version, '1.1.0') < 0) {
  //   input['player.newKey'] = input['player.oldKey']
  //   delete input['player.oldKey']
  //   version = '1.1.0'
  // }

  input.version = version
  return input as Partial<import('../types/app_setting').AppSetting>
}
