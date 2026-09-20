/**
 * 主进程入口
 *
 * 启动顺序（很重要，顺序错了会出现配置/缓存写到两个不同目录）：
 *   1. setupUserDataPath()  —— 最早期判断便携模式，改写 userData
 *   2. app.whenReady()
 *   3. initSetting()        —— 读盘 + 迁移 + 合并默认值
 *   4. registerIpcHandlers()
 *   5. createMainWindow() / createTray()
 */
import {
  app,
  BrowserWindow,
  session,
  screen,
  Tray,
  Menu,
  nativeImage,
} from 'electron'
import path from 'node:path'
import { registerIpcHandlers } from './ipcHandlers'
import { setupUserDataPath, isPortable } from './portable'
import {
  initSetting,
  flushSetting,
  getSetting,
  updateSetting,
  onSettingChange,
} from './utils/setting'
import * as biliApi from './biliApi'
import { initPlaylists, flushPlaylists } from './utils/playlist'
import { PLAY_LOOP_MODES } from '@common/constants'

// electron-as-wallpaper 是原生模块，且只在 Windows 有意义，加载失败不应该影响主功能
type AsWallpaper = typeof import('electron-as-wallpaper')
let asWallpaper: AsWallpaper | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  asWallpaper = require('electron-as-wallpaper') as AsWallpaper
} catch {
  asWallpaper = null
}

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let loginWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isLoggedIn = false
let isPaused = true
let loopModeIndex = 0
let wallpaperEnabled = false
/**
 * 是否处于「全屏」
 *
 * 关键：这是**应用层自己维护**的状态，绝对不要读 `mainWindow.isFullScreen()`。
 *
 * 主窗口是 `transparent: true`，Windows 上透明窗口的原生全屏是失效的：
 * `setFullScreen(true)` 只会把窗口撑到屏幕大小，`isFullScreen()` 依旧返回 false
 * （electron/electron#27286）。于是老代码里出现了一连串问题：
 *   - 状态被原生值回写，全屏标志永远为 false；
 *   - 退出壁纸模式时「还原」逻辑反而把窗口撑成整屏，且因为没有状态可翻转，
 *     再点全屏只会一路往「进入全屏」走，永远退不出去。
 *
 * 所以全屏改成应用层模拟：解除 16:9 约束 + setBounds 铺满主屏 + 置顶盖住任务栏。
 */
let isFullScreen = false
let isMaximized = false

/** 主窗口的宽高比约束（视频播放器保持 16:9） */
const FULLSCREEN_ASPECT = 16 / 9

const MODE_NAMES = ['列表循环', '单曲循环', '随机播放']

/** 进入全屏前的普通窗口状态，退出全屏时据此还原 */
interface FullScreenRestore {
  /** 普通窗口尺寸 */
  bounds: Electron.Rectangle
  maximized: boolean
}
let fullScreenRestore: FullScreenRestore | null = null

/** 进入壁纸模式前的窗口状态，退出壁纸时据此还原 */
interface WallpaperRestore {
  /** 进入壁纸之前是否已经是全屏 */
  fullScreen: boolean
  /** 退出壁纸后（非全屏时）要还原的普通窗口尺寸 */
  bounds: Electron.Rectangle
  maximized: boolean
}
let wallpaperRestore: WallpaperRestore | null = null


app.commandLine.appendSwitch('force-device-scale-factor', '1')

/** 统一的资源路径解析：开发期读 public/，打包后读 out/ */
const resolveAsset = (file: string): string =>
  isDev
    ? path.join(app.getAppPath(), 'public', file)
    : path.join(app.getAppPath(), file)

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 800,
    minHeight: 450,
    title: 'B站音乐视频',
    frame: false,
    center: true,
    transparent: true,
    icon: resolveAsset('bili.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // contextIsolation 必须保持开启：preload 通过 contextBridge 暴露类型化 api，
      // 页面本身拿不到 ipcRenderer，这是安全边界，不做简化
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  mainWindow.setAspectRatio(FULLSCREEN_ASPECT)

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    mainWindow.show()
    // 配置里的壁纸模式优先，命令行 --wallpaper-mode 作为兜底
    wallpaperEnabled =
      getSetting()['common.wallpaperMode'] || process.argv.includes('--wallpaper-mode')
    if (wallpaperEnabled) {
      // 开机即壁纸模式：applyWallpaperMode 会把此刻的普通窗口尺寸记成还原点，
      // 这样用户切回「应用程序」时能还原成正常窗口而不是被困在全屏
      void applyWallpaperMode(true).then(() => {
        sendToMain('wallpaper:state', true)
      })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('maximize', () => {
    if (!mainWindow) return
    isMaximized = mainWindow.isMaximized()
    sendToMain('window:maximized', isMaximized)
  })

  mainWindow.on('unmaximize', () => {
    if (!mainWindow) return
    isMaximized = mainWindow.isMaximized()
    sendToMain('window:maximized', isMaximized)
  })

  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // 注意：这里只同步「最大化」，不再回写 isFullScreen。
    // 全屏是应用层模拟的，窗口尺寸会被撑到整屏，
    // 一旦从原生状态回读就会把全屏标志抹成 false（老 bug 的根源之一）。
    const realMaximized = mainWindow.isMaximized()
    if (isMaximized !== realMaximized) {
      isMaximized = realMaximized
      sendToMain('window:maximized', isMaximized)
    }
  })
}

/** 向主窗口发送广播（窗口不存在时静默忽略） */
function sendToMain(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/**
 * 取当前窗口作为「普通窗口」时的尺寸与最大化状态
 *
 * 只在窗口不是全屏时调用：全屏是我们自己用 setBounds 撑出来的，
 * `getBounds()` / `getNormalBounds()` 都会返回整屏尺寸，不能拿来当还原点。
 */
const readNormalWindowState = (): FullScreenRestore => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { bounds: { x: 160, y: 70, width: 1600, height: 900 }, maximized: false }
  }
  const maximized = mainWindow.isMaximized()
  return {
    // 最大化时 getBounds 是工作区大小，要取 normalBounds 才是还原用的尺寸
    bounds: maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds(),
    maximized,
  }
}

/** 把窗口撑满主屏（全屏的几何部分） */
const applyFullScreenGeometry = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // 16:9 的宽高比约束会把 setBounds 的结果改写掉，全屏时必须先解除，
  // 否则在非 16:9 的显示器上窗口撑不满，看起来就「没全屏」
  mainWindow.setAspectRatio(0)
  mainWindow.setBounds(screen.getPrimaryDisplay().bounds)
  // 不置顶的话任务栏会压在窗口上面，看起来也不像全屏
  mainWindow.setAlwaysOnTop(true)
}

/** 记录「进入全屏前」的普通窗口状态（已有记录则保留，避免被全屏几何污染） */
const captureFullScreenRestore = (): void => {
  if (fullScreenRestore) return
  fullScreenRestore = readNormalWindowState()
  console.log('[win] 记录全屏还原点:', JSON.stringify(fullScreenRestore))
}

/** 进入全屏：记还原点 + 撑满主屏 */
const enterFullScreen = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  captureFullScreenRestore()
  isFullScreen = true
  applyFullScreenGeometry()
}

/** 退出全屏：回到普通窗口（最大化则恢复最大化） */
const exitFullScreen = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  isFullScreen = false
  mainWindow.setAlwaysOnTop(false)
  mainWindow.setAspectRatio(FULLSCREEN_ASPECT)

  const point = fullScreenRestore
  fullScreenRestore = null
  if (!point) {
    // 没有记录（异常情况）：给一个合理的默认窗口尺寸，别把用户困在全屏
    mainWindow.setSize(1600, 900)
    mainWindow.center()
    return
  }
  if (point.maximized) mainWindow.maximize()
  else mainWindow.setBounds(point.bounds)
}

/** 退出壁纸模式：按壁纸还原点回到全屏 / 最大化 / 普通窗口 */
const exitWallpaperGeometry = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const point = wallpaperRestore
  wallpaperRestore = null

  if (point?.fullScreen) {
    // 进入壁纸之前本来就是全屏，退出后回到全屏
    // （fullScreenRestore 仍然有效，用户还能再按 F 退出全屏）
    isFullScreen = true
    applyFullScreenGeometry()
    return
  }

  isFullScreen = false
  mainWindow.setAlwaysOnTop(false)
  mainWindow.setAspectRatio(FULLSCREEN_ASPECT)
  if (!point) {
    // 没有记录（异常情况）：给一个合理的默认窗口尺寸，别把用户困在全屏
    mainWindow.setSize(1600, 900)
    mainWindow.center()
    return
  }
  if (point.maximized) mainWindow.maximize()
  else mainWindow.setBounds(point.bounds)
}

/** 全屏状态变化后通知渲染进程 */
const syncFullScreenState = (): void => {
  sendToMain('window:fullscreen', isFullScreen)
}

function toggleFullScreen(): void {
  // 壁纸模式下窗口几何由壁纸层接管，不允许用户再切全屏
  if (!mainWindow || mainWindow.isDestroyed() || wallpaperEnabled) return
  setFullScreenState(!isFullScreen)
}

/**
 * 把全屏状态设为指定值（幂等）
 *
 * 老实现是「翻转」语义（isFullScreen = !isFullScreen）叠加原生 setFullScreen：
 * 原生调用在透明窗口上无效，于是状态和窗口真实几何彻底脱节，
 * 出现「退出壁纸后又变成退不掉的全屏」。现在显式设定目标状态，
 * 并且全屏完全由应用层模拟（原因见 isFullScreen 的注释）。
 */
function setFullScreenState(target: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (target === isFullScreen) {
    syncFullScreenState()
    return
  }

  if (target) {
    enterFullScreen()
  } else if (wallpaperEnabled) {
    // 壁纸模式下几何由壁纸层接管，只改状态
    if (wallpaperRestore) wallpaperRestore.fullScreen = false
    isFullScreen = false
  } else {
    exitFullScreen()
  }

  syncFullScreenState()
}

/** 记录「进入壁纸模式前」的窗口状态（已有记录则保留） */
const captureWallpaperRestore = (): void => {
  if (wallpaperRestore || !mainWindow || mainWindow.isDestroyed()) return
  wallpaperRestore = isFullScreen
    ? {
        fullScreen: true,
        // 全屏时窗口尺寸就是整屏，普通尺寸要问全屏还原点
        bounds: fullScreenRestore?.bounds ?? mainWindow.getBounds(),
        maximized: fullScreenRestore?.maximized ?? false,
      }
    : { fullScreen: false, ...readNormalWindowState() }
  console.log('[wallpaper] 记录还原点:', JSON.stringify(wallpaperRestore))
}

/**
 * 应用壁纸模式
 *
 * 修复要点（老 bug）：
 *  1. **先把窗口几何铺满主屏，再挂壁纸层**。
 *     原实现是先 attach 再切全屏，挂载时窗口还是普通尺寸，
 *     所以「进了壁纸模式但没在壁纸层全屏」。
 *  2. 完全不调用原生 setFullScreen：主窗口是 `transparent: true`，
 *     Windows 上原生全屏对透明窗口无效（见 isFullScreen 的注释），
 *     改用「解除宽高比约束 + 铺满主屏 + 置顶」在应用层实现。
 *  3. 进入前用独立的 wallpaperRestore 记录窗口状态，退出时原样还原
 *     （原本是全屏就回到全屏，原本是最大化就回到最大化），
 *     不会再出现「退不出去的全屏」。
 */
async function applyWallpaperMode(enabled: boolean): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (enabled) {
    // 1) 先记住进入前的状态（已有记录则保留更早的那个）
    captureWallpaperRestore()

    // 2) 先把窗口铺满主屏 —— 必须在挂到壁纸层之前完成
    applyFullScreenGeometry()
    mainWindow.setVisibleOnAllWorkspaces(true)
    isFullScreen = true
    // 壁纸层跟随窗口几何，等系统把尺寸应用完再挂载，否则 attach 拿到的是旧几何
    await new Promise((resolve) => setTimeout(resolve, 120))

    // 3) 几何就绪后再挂到壁纸层
    try {
      asWallpaper?.attach(mainWindow, {
        transparent: true,
        forwardMouseInput: true,
        forwardKeyboardInput: false,
      })
    } catch (err) {
      console.error('[wallpaper] attach 失败:', err)
    }

    // 4) 壁纸模式下托盘没有意义，先移除
    if (tray && !tray.isDestroyed()) {
      tray.destroy()
      tray = null
    }
  } else {
    // 退出壁纸模式：先脱离壁纸层，再恢复窗口状态
    try {
      asWallpaper?.detach(mainWindow)
    } catch {
      /* ignore */
    }
    try {
      asWallpaper?.reset()
    } catch {
      /* ignore */
    }

    mainWindow.setVisibleOnAllWorkspaces(false)

    // 等壁纸层把窗口还回来，再还原尺寸，否则 setBounds 会被忽略
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (mainWindow && !mainWindow.isDestroyed()) exitWallpaperGeometry()

    createTray()
  }

  // 通知渲染进程同步状态（全屏标志可能变了）
  syncFullScreenState()
}

async function toggleWallpaper(): Promise<boolean> {
  if (!asWallpaper || !mainWindow || mainWindow.isDestroyed()) return wallpaperEnabled
  wallpaperEnabled = !wallpaperEnabled

  // 同步写回配置，这样下次启动能记住壁纸模式（配置由主进程持有）
  updateSetting({ 'common.wallpaperMode': wallpaperEnabled })

  await applyWallpaperMode(wallpaperEnabled)

  sendToMain('wallpaper:state', wallpaperEnabled)
  buildTrayMenu()
  return wallpaperEnabled
}

function createLoginWindow(): void {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }

  loginWindow = new BrowserWindow({
    width: 1150,
    height: 600,
    parent: mainWindow ?? undefined,
    modal: true,
    title: '账号登录',
    frame: false,
    webPreferences: {
      session: session.defaultSession,
    },
  })

  void loginWindow.loadURL('https://passport.bilibili.com/login')

  let loginAutoCloseTimer: ReturnType<typeof setTimeout> | null = null
  let loginPollTimer: ReturnType<typeof setInterval> | null = null
  const isLoginWallpaper = wallpaperEnabled
  if (isLoginWallpaper) {
    loginAutoCloseTimer = setTimeout(() => {
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
    }, 15000)
  }

  /**
   * 打开登录窗口时已有的 SESSDATA（可能是已经过期的旧值）
   *
   * `null` 表示基线还没读出来，此时不做任何判断。
   */
  let initialSessdata: string | null = null
  const readSessdata = async (): Promise<string> => {
    try {
      const cookies = await session.defaultSession.cookies.get({})
      return cookies.find((c) => c.name === 'SESSDATA' && c.value)?.value ?? ''
    } catch {
      return ''
    }
  }
  void readSessdata().then((value) => {
    initialSessdata = value
  })

  /**
   * 检查是否登录成功，成功则收尾
   *
   * 两步走，缺一不可：
   *  1. **cookie 变化当触发器** —— SESSDATA 必须和打开窗口时的值不同，
   *     否则「本来就有一个过期 SESSDATA」会被误判成登录成功，窗口一闪就关；
   *  2. **接口裁定** —— cookie 存在不代表登录有效（可能被风控或已过期），
   *     清掉 nav 缓存后问一次 `isLogin`，以接口为准。
   *
   * 之所以不能只靠 `did-navigate`：B 站登录可能走 SPA 内部跳转，
   * 用户也可能登录完直接手动关窗 —— 这两条路都触发不了导航事件，
   * 于是「登录成功」没人告诉主进程，必须重启一次才生效。
   */
  const finishLoginIfReady = async (): Promise<boolean> => {
    if (initialSessdata === null) return false
    const sessdata = await readSessdata()
    if (!sessdata || sessdata === initialSessdata) return false

    // 丢掉「未登录时」拿到的 nav / wbi / 用户信息缓存，
    // 否则 isLoggedIn() 还是 false，解析播放地址时仍按未登录处理
    biliApi.clearNavData()
    const ok = await biliApi.ensureLoginState()
    if (!ok) return false

    if (loginPollTimer) {
      clearInterval(loginPollTimer)
      loginPollTimer = null
    }
    if (loginAutoCloseTimer) {
      clearTimeout(loginAutoCloseTimer)
      loginAutoCloseTimer = null
    }
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close()
    loginWindow = null
    isLoggedIn = true
    buildTrayMenu()
    sendToMain('auth:loginSuccess')
    return true
  }

  // 登录页可能不触发顶层导航，轮询 cookie 兜底
  loginPollTimer = setInterval(() => {
    void finishLoginIfReady()
  }, 1000)

  loginWindow.webContents.on('did-navigate', () => {
    void finishLoginIfReady()
  })

  loginWindow.webContents.on('dom-ready', () => {
    if (!loginWindow || loginWindow.isDestroyed()) return
    void loginWindow.webContents.insertCSS(`
      .mimo-close-btn {
        position: fixed; top: 0; right: 0; z-index: 99999;
        width: 36px; height: 36px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: rgba(0,0,0,0.4);
        transition: background 0.15s, color 0.15s;
      }
      .mimo-close-btn:hover { background: #e81123; color: white; }
      .mimo-countdown {
        position: fixed; top: 0; left: 0; z-index: 99999;
        padding: 4px 12px;
        font-size: 30px; font-weight: 700;
        color: #e81123;
        pointer-events: none;
        font-family: system-ui, sans-serif;
      }
    `)
    void loginWindow.webContents.executeJavaScript(`
      ${
        !isLoginWallpaper
          ? `
      const btn = document.createElement('div');
      btn.className = 'mimo-close-btn';
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      btn.onclick = () => window.close();
      document.body.appendChild(btn);
      `
          : ''
      }
      ${
        isLoginWallpaper
          ? `
      const cd = document.createElement('div');
      cd.className = 'mimo-countdown';
      document.body.appendChild(cd);
      let remain = 15;
      cd.textContent = remain + '秒 后自动关闭,请尽快登录';
      const iv = setInterval(() => {
        remain--;
        if (remain <= 0) { clearInterval(iv); return; }
        cd.textContent = remain + '秒 后自动关闭,请尽快登录';
      }, 1000);
      `
          : ''
      }
    `)
  })

  loginWindow.on('closed', () => {
    if (loginPollTimer) {
      clearInterval(loginPollTimer)
      loginPollTimer = null
    }
    if (loginAutoCloseTimer) {
      clearTimeout(loginAutoCloseTimer)
      loginAutoCloseTimer = null
    }
    loginWindow = null
    // 手动关窗也再确认一次：用户很可能就是登录完直接把窗口关掉的
    void finishLoginIfReady()
  })
}

function buildTrayMenu(): void {
  const send = (channel: string): void => sendToMain(channel)
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: isPaused ? '播放' : '暂停',
      click: () => send('tray:playControl'),
    },
    { label: '上一首', click: () => send('tray:prev') },
    { label: '下一首', click: () => send('tray:next') },
    {
      label: MODE_NAMES[loopModeIndex] ?? MODE_NAMES[0],
      click: () => send('tray:toggleMode'),
    },
    { type: 'separator' },
    {
      label: '设置歌单',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          mainWindow.focus()
          send('tray:showPlaylist')
        }
      },
    },
    {
      label: wallpaperEnabled ? '应用程序' : '桌面壁纸',
      click: () => {
        void toggleWallpaper()
      },
    },
    { type: 'separator' },
    {
      label: isLoggedIn ? '退出登录' : '登录',
      click: () => {
        if (isLoggedIn) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            mainWindow.focus()
            send('tray:showLogoutConfirm')
          }
        } else {
          createLoginWindow()
        }
      },
    },
    { label: '退出应用', click: () => app.quit() },
  ]
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resolveAsset('bili.ico'))
  tray = new Tray(icon)
  tray.setToolTip('B站音乐视频')
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  buildTrayMenu()
}

async function grabCookiesSilently(): Promise<void> {
  const cookieWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: { session: session.defaultSession },
  })

  return new Promise((resolve) => {
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      if (!cookieWindow.isDestroyed()) cookieWindow.destroy()
      resolve()
    }

    let pollCount = 0
    const poll = async (): Promise<void> => {
      if (settled) return
      pollCount++
      try {
        const cookies = await session.defaultSession.cookies.get({})
        if (cookies.some((c) => c.name === 'buvid3')) {
          settled = true
          if (!cookieWindow.isDestroyed()) cookieWindow.destroy()
          resolve()
          return
        }
      } catch {
        /* ignore */
      }
      if (pollCount < 20) setTimeout(() => void poll(), 500)
      else settle()
    }

    cookieWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => void poll(), 1000)
    })
    cookieWindow.webContents.on('did-fail-load', () => settle())
    cookieWindow.loadURL('https://www.bilibili.com/').catch(() => settle())
  })
}

/** 清除 B 站登录态 cookie */
async function executeLogout(): Promise<void> {
  isLoggedIn = false
  biliApi.clearNavData()
  const cookies = await session.defaultSession.cookies.get({})
  for (const c of cookies) {
    if (c.name === 'SESSDATA' || c.name === 'bili_jct' || c.name === 'DedeUserID') {
      await session.defaultSession.cookies.remove(
        `http${c.secure ? 's' : ''}://${(c.domain ?? '').replace(/^\./, '')}${c.path}`,
        c.name,
      )
    }
  }
  sendToMain('auth:logout')
  buildTrayMenu()
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

// 第 1 步：必须最早执行，改写 userData 之后再碰任何路径相关的 API
setupUserDataPath()

void app.whenReady().then(async () => {
  // 第 2 步：初始化配置（读盘 + 迁移 + 合并默认值）与歌单集合
  initSetting()
  initPlaylists()

  // 配置变化时同步托盘菜单（例如壁纸模式被另一处改动）
  onSettingChange(() => {
    buildTrayMenu()
  })

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.bilivideo.com/*', '*://*.bilibili.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://www.bilibili.com/'
      callback({ requestHeaders: details.requestHeaders })
    },
  )

  // 第 3 步：注册 IPC
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    createLoginWindow,
    toggleFullScreen,
    isFullScreen: () => isFullScreen,
    toggleWallpaper,
    isWallpaperEnabled: () => wallpaperEnabled,
    startWindowDrag,
    moveWindow: (x, y) => {
      mainWindow?.setPosition(Math.round(x), Math.round(y))
    },
    getScreenWorkArea,
    setLoggedIn: (loggedIn) => {
      isLoggedIn = loggedIn
      buildTrayMenu()
    },
    updateTrayState: (state) => {
      if (state.paused !== undefined) isPaused = state.paused
      if (state.loopMode !== undefined) {
        const idx = PLAY_LOOP_MODES.indexOf(state.loopMode as (typeof PLAY_LOOP_MODES)[number])
        if (idx >= 0) loopModeIndex = idx
      }
      buildTrayMenu()
    },
    executeLogout,
    quitApp: () => app.quit(),
  })

  // 第 4 步：创建窗口与托盘
  createMainWindow()
  createTray()

  void grabCookiesSilently()

  console.log(`[main] ready (dev=${String(isDev)}, portable=${String(isPortable())})`)
})

/** 拖动窗口：处理全屏/最大化状态下先还原再跟手移动 */
function startWindowDrag(): { offsetX: number; offsetY: number } | null {
  if (!mainWindow) return null
  const cursor = screen.getCursorScreenPoint()

  if (isFullScreen) {
    // 全屏时拖动 = 退出全屏，并按鼠标在窗口中的相对位置把窗口摆到鼠标下
    const fullBounds = mainWindow.getBounds()
    const normalBounds = fullScreenRestore?.bounds ?? fullBounds
    const ratioX = fullBounds.width > 0 ? cursor.x / fullBounds.width : 0.5
    const ratioY = fullBounds.height > 0 ? cursor.y / fullBounds.height : 0.5
    isFullScreen = false
    fullScreenRestore = null
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setAspectRatio(FULLSCREEN_ASPECT)
    syncFullScreenState()
    mainWindow.setBounds({
      x: Math.round(cursor.x - ratioX * normalBounds.width),
      y: Math.round(cursor.y - ratioY * normalBounds.height),
      width: normalBounds.width,
      height: normalBounds.height,
    })
  }

  if (mainWindow.isMaximized()) {
    const fullBounds = mainWindow.getBounds()
    const normalBounds = mainWindow.getNormalBounds()
    const ratioX = cursor.x / fullBounds.width
    const ratioY = cursor.y / fullBounds.height
    mainWindow.unmaximize()
    mainWindow.setBounds({
      x: Math.round(cursor.x - ratioX * normalBounds.width),
      y: Math.round(cursor.y - ratioY * normalBounds.height),
      width: normalBounds.width,
      height: normalBounds.height,
    })
    const newBounds = mainWindow.getBounds()
    return { offsetX: cursor.x - newBounds.x, offsetY: cursor.y - newBounds.y }
  }

  const bounds = mainWindow.getBounds()
  return { offsetX: cursor.x - bounds.x, offsetY: cursor.y - bounds.y }
}

function getScreenWorkArea(): Electron.Rectangle | null {
  if (!mainWindow) return null
  const bounds = mainWindow.getBounds()
  return screen.getDisplayMatching(bounds).workArea
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createMainWindow()
})

// 退出前把防抖里待写入的配置/歌单刷到磁盘，避免最后几秒的修改丢失
app.on('before-quit', () => {
  flushSetting()
  flushPlaylists()
})

// 兜底：进程即将退出时同步再刷一次
process.on('exit', () => {
  try {
    flushSetting()
    flushPlaylists()
  } catch {
    /* ignore */
  }
})
