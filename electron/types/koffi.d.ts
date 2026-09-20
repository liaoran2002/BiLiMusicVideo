/**
 * koffi 的最小类型声明
 *
 * koffi 用于调用 Windows user32.dll 判断窗口是否挂在 WorkerW 层（桌面壁纸层）。
 * 它没有随包提供类型，这里声明本项目实际用到的那几个 API 即可，
 * 避免为了一个 DLL 调用引入 any 到处扩散。
 */
declare module 'koffi' {
  /** 不透明指针 */
  export type KoffiPointer = unknown

  export interface KoffiFunc {
    (...args: unknown[]): unknown
  }

  export interface KoffiModule {
    /** 载入动态库 */
    load(path: string): {
      func(name: string, returnType: string, argTypes: string[]): KoffiFunc
    }
    /** 分配内存 */
    alloc(type: string, count: number): unknown
    /** 从内存解码值 */
    decode(buffer: unknown, type: string): unknown
  }

  const koffi: KoffiModule
  export default koffi
}
