/**
 * 自绘托盘菜单（菜单窗口的页面）
 *
 * 为什么不用原生 `Menu.popup`：壁纸模式开着鼠标转发（`electron-as-wallpaper`
 * 注册 `RIDEV_INPUTSINK` 把全系统鼠标事件合成点击塞进壁纸窗口），
 * 原生弹出菜单会被这些合成点击当场关掉。这个页面跑在**独立置顶窗口**里，
 * 收的是真实鼠标消息，所以菜单项点得动，也能盖在任务栏上面。
 *
 * 渲染流程：主进程 `trayMenu:state` 推状态 → 本页渲染 → 量高度回报 `trayMenu:ready`
 * → 主进程按高度定位并显示。点击项目 → `trayMenu:action` → 主进程收起菜单并执行。
 */
import type { TrayMenuAction, TrayMenuState } from '@common/types/ipc'
import api from '@/api/electron'

/** 菜单项定义：动作 + 文案（文案/动作都可按状态变化） */
interface Item {
  /** 'sep' 是分隔线；函数形式表示按当前状态决定动作 */
  action: TrayMenuAction | 'sep' | ((s: TrayMenuState) => TrayMenuAction)
  label: (s: TrayMenuState) => string
  hint?: (s: TrayMenuState) => string
  danger?: boolean
}

const ITEMS: Item[] = [
  {
    action: 'playControl',
    label: (s) => (s.paused ? '播放' : '暂停'),
  },
  { action: 'prev', label: () => '上一首' },
  { action: 'next', label: () => '下一首' },
  {
    action: 'toggleMode',
    label: (s) => s.loopModeName,
    hint: () => '切换',
  },
  { action: 'sep', label: () => '' },
  { action: 'showPlaylist', label: () => '设置歌单' },
  {
    // 窗口被收到托盘里时，这一项换成「恢复窗口」（动作也跟着换）
    action: (s) => (s.windowHidden ? 'restoreWindow' : 'toggleWallpaper'),
    label: (s) => (s.windowHidden ? '恢复窗口' : s.wallpaperEnabled ? '窗口模式' : '壁纸模式'),
  },
  { action: 'sep', label: () => '' },
  { action: 'login', label: (s) => (s.isLoggedIn ? '退出登录' : '登录') },
  { action: 'quit', label: () => '退出应用', danger: true },
]

const root = document.getElementById('menu') as HTMLElement

/** 渲染菜单（每次都重建，数量很少） */
const render = (state: TrayMenuState): void => {
  root.textContent = ''
  if (state.title) {
    const now = document.createElement('div')
    now.className = 'now'
    now.textContent = state.title
    now.title = state.title
    root.appendChild(now)
  }
  for (const item of ITEMS) {
    if (item.action === 'sep') {
      const sep = document.createElement('div')
      sep.className = 'sep'
      root.appendChild(sep)
      continue
    }
    const actionOf = typeof item.action === 'function' ? item.action(state) : item.action
    const el = document.createElement('div')
    el.className = item.danger ? 'item danger' : 'item'
    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = item.label(state)
    el.appendChild(label)
    if (item.hint) {
      const hint = document.createElement('span')
      hint.className = 'hint'
      hint.textContent = item.hint(state)
      el.appendChild(hint)
    }
    /**
     * 用 `mouseup` 而不是 `click` 触发动作 —— 壁纸模式下的必须
     *
     * 壁纸模式开着鼠标转发，按下鼠标时库会往壁纸窗口塞一个合成 `WM_LBUTTONDOWN`，
     * Chromium 随即在那里 `SetCapture`，**真实的 mousedown 被壁纸窗口抢走**，
     * 菜单页面只收得到 mouseover + mouseup。down / up 不在同一个元素上，
     * 浏览器就不会合成 `click` —— 表现就是「菜单点了没反应」。
     * mouseup 是能收到的，所以用它，并校验左键、避免拖进来松手误触发。
     */
    el.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return
      void api.trayMenuAction(actionOf)
    })
    root.appendChild(el)
  }
}

/** 把量到的高度报给主进程（它据此定位与显示） */
const reportHeight = (): void => {
  const height = Math.ceil(root.getBoundingClientRect().height)
  void api.trayMenuReady(height)
}

let lastState: TrayMenuState | null = null

api.onTrayMenuState((state) => {
  lastState = state
  render(state)
  reportHeight()
})

// Esc 收起（和原生菜单一致）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void api.trayMenuClose()
})

// 首帧先要一次状态：主进程可能在我们监听之前就推过了
void api.trayMenuGetState().then((state) => {
  if (lastState) return
  render(state)
  reportHeight()
})
