/**
 * 广播事件名（主进程 -> 渲染进程）
 *
 * 只有这一处是真的按名字引用的；invoke 频道（`win:*` / `api:*` / ...）
 * 的类型来自 `types/ipc.ts` 里的 ChannelMap，注册与调用都直接写字符串字面量，
 * 由 TS 兜底，所以那些 `XXX_EVENT_NAME` 常量对象属于没用的中间层，已经删掉。
 */

/** 主进程 -> 渲染进程的广播事件名 */
export const BROADCAST_EVENT_NAME = {
  settingUpdate: 'setting:update',
  authLogout: 'auth:logout',
  authLoginSuccess: 'auth:loginSuccess',
  trayPlayControl: 'tray:playControl',
  trayPrev: 'tray:prev',
  trayNext: 'tray:next',
  trayToggleMode: 'tray:toggleMode',
  trayShowPlaylist: 'tray:showPlaylist',
  trayShowLogoutConfirm: 'tray:showLogoutConfirm',
  wallpaperState: 'wallpaper:state',
  windowMaximized: 'window:maximized',
  windowFullscreen: 'window:fullscreen',
} as const
