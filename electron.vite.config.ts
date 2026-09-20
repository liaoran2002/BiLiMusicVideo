import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

/**
 * electron-vite 配置
 *
 * 相比原来的「纯 Vite + CommonJS 主进程」，这里改为三个构建目标：
 *   main     -> out/main/index.js      (Node / CommonJS)
 *   preload  -> out/preload/index.js   (沙箱 / CommonJS)
 *   renderer -> out/renderer/          (浏览器)
 *
 * 关键点（踩坑记录）：
 * 1. 别名必须在 electron.vite.config.ts 和 tsconfig.*.json 里**同时**配置：
 *    前者给构建器用，后者给 tsc / IDE 用，少一个就会出现
 *    「构建能过但编辑器报红」或反之。
 * 2. electron/common 被 main、preload、renderer 三方共享，
 *    所以每个 target 的 alias 都要指向它。
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@common': resolve(__dirname, 'electron/common'),
        '@main': resolve(__dirname, 'electron/main'),
      },
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'electron/main/index.ts'),
        // 原生模块不能被打包，必须在运行时 require
        external: ['electron-as-wallpaper', 'koffi'],
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@common': resolve(__dirname, 'electron/common'),
      },
    },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'electron/preload/index.ts'),
      },
    },
  },

  renderer: {
    // 渲染进程源码仍在 src/，入口是根目录的 index.html
    root: __dirname,
    plugins: [vue()],
    resolve: {
      alias: {
        '@common': resolve(__dirname, 'electron/common'),
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
  },
})
