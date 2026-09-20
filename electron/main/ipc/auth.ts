/**
 * 登录相关 IPC
 */
import { mainHandle } from '@common/mainIpc'
import * as biliApi from '../biliApi'
import type { IpcContext } from '../ipcHandlers'

export const registerAuthHandlers = (context: IpcContext): void => {
  mainHandle('auth:startLogin', () => {
    context.createLoginWindow()
  })

  mainHandle('auth:reLogin', async () => {
    biliApi.clearNavData()
    const { session } = await import('electron')
    const cookies = await session.defaultSession.cookies.get({})
    for (const c of cookies) {
      if (c.name === 'SESSDATA' || c.name === 'bili_jct' || c.name === 'DedeUserID') {
        await session.defaultSession.cookies.remove(
          `http${c.secure ? 's' : ''}://${(c.domain ?? '').replace(/^\./, '')}${c.path}`,
          c.name,
        )
      }
    }
    context.createLoginWindow()
  })

  mainHandle('auth:setLoggedIn', ({ loggedIn }) => {
    context.setLoggedIn(loggedIn)
  })

  mainHandle('auth:executeLogout', async () => {
    await context.executeLogout()
  })
}
