/**
 * 配置相关 IPC
 *
 * 这是「主进程接管 setting」对渲染进程暴露的唯一入口：
 *   - setting:get     拉取完整配置（渲染进程启动时填充 Pinia）
 *   - setting:update  局部更新，只接收 Partial<AppSetting>
 *   - setting:reset   恢复默认
 *
 * 更新后广播 setting:update 给**所有** webContents，实现多窗口同步。
 */
import { BROADCAST_EVENT_NAME } from '@common/ipcNames'
import { mainHandle, broadcast } from '@common/mainIpc'
import type { AppSetting } from '@common/types/app_setting'
import { getSetting, updateSetting, resetSetting } from '../utils/setting'

export const registerSettingHandlers = (): void => {
  mainHandle('setting:get', () => getSetting())

  mainHandle('setting:update', (params: Partial<AppSetting>) => {
    const updated = updateSetting(params)
    // 只有真的改变了才广播，避免渲染进程自己触发的更新又同步回来造成循环
    if (Object.keys(updated).length > 0) {
      broadcast(BROADCAST_EVENT_NAME.settingUpdate, updated)
    }
    return getSetting()
  })

  mainHandle('setting:reset', () => {
    const setting = resetSetting()
    broadcast(BROADCAST_EVENT_NAME.settingUpdate, setting)
    return setting
  })
}
