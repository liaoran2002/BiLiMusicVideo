/// <reference types="vite/client" />

/**
 * .vue 单文件组件的类型声明
 *
 * 有了它，渲染进程 import App from './App.vue' 才有类型；
 * 配合 vue-tsc 可以对 <template> 里的表达式做类型检查。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/** 图标字体等静态资源 */
declare module '*.css' {
  const css: string
  export default css
}
