/**
 * 判断窗口是否位于 WorkerW 层（Windows 桌面壁纸层）
 *
 * 原为 electron/wallpaperDetect.js（CommonJS），迁移为 TS。
 * 通过 koffi 直接调用 user32.dll 的 FindWindowA / SendMessageTimeoutA / GetParent。
 *
 * 注意：koffi 是可选的原生依赖，这里必须**惰性加载**。
 * 原来的 CommonJS 写法 `require('koffi')` 一旦依赖缺失就会在模块加载阶段
 * 直接抛错，把整个主进程带崩；改成函数内动态 import + 容错后，
 * 缺少 koffi 只会让这个检测功能失效，不影响应用启动。
 */
const SMTO_ABORTIFHUNG = 0x0002

interface User32 {
  FindWindowA: (className: string | null, windowName: string | null) => unknown
  GetParent: (hwnd: unknown) => unknown
  SendMessageTimeoutA: (
    hwnd: unknown,
    msg: number,
    wParam: number,
    lParam: number,
    flags: number,
    timeout: number,
    result: unknown,
  ) => number
}

interface KoffiModule {
  load: (path: string) => User32
  alloc: (type: string, count: number) => unknown
  decode: (buffer: unknown, type: string) => unknown
}

let koffi: KoffiModule | null = null
let loadFailed = false

const loadKoffi = async (): Promise<KoffiModule | null> => {
  if (koffi) return koffi
  if (loadFailed) return null
  try {
    const mod = (await import('koffi')) as unknown as { default?: KoffiModule } & KoffiModule
    koffi = (mod.default ?? mod) as KoffiModule
    return koffi
  } catch (err) {
    loadFailed = true
    console.error('[wallpaperDetect] koffi unavailable, detection disabled:', err)
    return null
  }
}

export const isInWorkerWLayer = async (hwnd: unknown): Promise<boolean> => {
  if (process.platform !== 'win32') return false
  const lib = await loadKoffi()
  if (!lib) return false

  try {
    const user32 = lib.load('user32.dll')
    const progman = user32.FindWindowA('Progman', null)
    if (!progman) return false

    const resultBuf = lib.alloc('int64', 1)
    const sendRet = user32.SendMessageTimeoutA(
      progman,
      0x0400 + 0x052c,
      0,
      0,
      SMTO_ABORTIFHUNG,
      1000,
      resultBuf,
    )
    if (sendRet === 0) return false

    const workerW = lib.decode(resultBuf, 'int64')
    if (workerW === 0) return false

    let current = hwnd
    for (let i = 0; i < 50; i++) {
      if (!current) return false
      if (current === workerW) return true
      current = user32.GetParent(current)
    }
    return false
  } catch (err) {
    console.error('[wallpaperDetect] failed:', err)
    return false
  }
}
