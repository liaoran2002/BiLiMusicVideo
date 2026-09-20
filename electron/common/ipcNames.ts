/**
 * IPC 频道名集中管理
 *
 * 参考 LX Music 的 src/common/ipcNames.ts
 *
 * 好处：频道名只在 common 里定义一次，主进程与 preload 都从这里引用，
 * 彻底杜绝「一边写 setting:update 一边写 setting:updateSetting」这种低级错误。
 */

export const SETTING_EVENT_NAME = {
  get: 'setting:get',
  update: 'setting:update',
  reset: 'setting:reset',
} as const

export const WINDOW_EVENT_NAME = {
  minimize: 'win:minimize',
  maximize: 'win:maximize',
  close: 'win:close',
  isMaximized: 'win:isMaximized',
  toggleFullscreen: 'win:toggleFullscreen',
  isFullscreen: 'win:isFullscreen',
  startDrag: 'win:startDrag',
  moveWindow: 'win:moveWindow',
  getScreenWorkArea: 'win:getScreenWorkArea',
} as const

export const AUTH_EVENT_NAME = {
  startLogin: 'auth:startLogin',
  reLogin: 'auth:reLogin',
  setLoggedIn: 'auth:setLoggedIn',
  executeLogout: 'auth:executeLogout',
} as const

export const API_EVENT_NAME = {
  getUserInfo: 'api:getUserInfo',
  searchSong: 'api:searchSong',
  resolveVideo: 'api:resolveVideo',
} as const

/** 音乐平台歌单解析（移植自 LX 的 musicSdk） */
export const MUSIC_EVENT_NAME = {
  getPlaylistDetail: 'music:getPlaylistDetail',
} as const

export const PLAYLIST_EVENT_NAME = {
  get: 'playlist:get',
  save: 'playlist:save',
} as const

export const CACHE_EVENT_NAME = {
  clearAll: 'cache:clearAll',
  clearSingle: 'cache:clearSingle',
} as const

export const WALLPAPER_EVENT_NAME = {
  toggle: 'wallpaper:toggle',
  isEnabled: 'wallpaper:isEnabled',
} as const

export const TRAY_EVENT_NAME = {
  updateState: 'tray:updateState',
} as const

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
