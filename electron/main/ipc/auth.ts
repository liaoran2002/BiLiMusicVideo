/**
 * 登录相关 IPC
 *
 * 曾经有个 `auth:reLogin`（清 cookie 再开登录窗），但渲染层从来没有调用方，
 * 已删掉；「重新登录」现在走 `auth:executeLogout` + `auth:startLogin` 两条现成的路。
 */
import { mainHandle } from '@common/mainIpc'
import type { IpcContext } from '../ipcHandlers'

export const registerAuthHandlers = (context: IpcContext): void => {
  mainHandle('auth:startLogin', () => {
    context.createLoginWindow()
  })

  mainHandle('auth:setLoggedIn', ({ loggedIn }) => {
    context.setLoggedIn(loggedIn)
  })

  mainHandle('auth:executeLogout', async () => {
    await context.executeLogout()
  })
}
