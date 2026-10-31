<template>
  <div id="app">
    <!--
      App 只负责「摆放骨架」：组件、video 元素和 store 启动。

      所有子组件都自己 `useAppStore()` 读写状态，不再由 App 转 props / emit。
      这样加一个弹窗按钮、改一个列表动作，都不需要动这个文件。
    -->
    <AppTitlebar />

    <!-- src 不绑在模板上：durl 直接用 URL，dash 需要挂 MediaSource，
         统一由 applyVideoSource() 设置，免得两条路互相覆盖 -->
    <video
      id="biliVideo"
      ref="video"
      @loadeddata="playback.onVideoLoaded"
      @timeupdate="playback.videoUpDate"
      @ended="playback.videoEnded"
      @error="playback.videoError"
      @waiting="playback.onVideoBuffering"
      @stalled="playback.onVideoBuffering"
      @seeking="playback.onVideoBuffering"
      @progress="playback.syncBufferState"
      @playing="playback.onVideoPlaying"
      @seeked="playback.syncBufferState"
      @canplaythrough="playback.syncBufferState"
      @play="playback.onVideoPlayStateChange"
      @pause="playback.onVideoPlayStateChange"
    ></video>

    <BufferOverlay />
    <SongVideoListDialog />
    <AddVideoDialog />
    <biliVideoControls />
    <CornerButtons />

    <!-- 歌单管理：新建 / 编辑 / 同步 / 曲目浏览全部在这一个弹窗里 -->
    <PlaylistManager />
    <SettingsDialog />
    <SleepTimerPanel />
    <AboutDialog />
  </div>
</template>

<script lang="ts">
import { defineComponent, onBeforeUnmount, onMounted } from 'vue';
import biliVideoControls from './components/biliVideoControls.vue';
import SongVideoListDialog from './components/SongVideoListDialog.vue';
import AddVideoDialog from './components/AddVideoDialog.vue';
import AppTitlebar from './components/AppTitlebar.vue';
import BufferOverlay from './components/BufferOverlay.vue';
import CornerButtons from './components/CornerButtons.vue';
import PlaylistManager from './components/PlaylistManager.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import AboutDialog from './components/AboutDialog.vue';
import SleepTimerPanel from './components/SleepTimerPanel.vue';
import { usePlaybackStore } from './stores/playback';
import { boot } from './stores/bootstrap';
import type { VideoElement } from './types/app';

/**
 * App —— 只剩骨架
 *
 * 原来这里有 117 个 data 字段、17 个 computed、119 个业务方法（4540 行）。
 * 现在它们全部搬进了 `stores/player/`，子组件也自己读写 Pinia；
 * 这个文件只负责三件事：
 *
 *  1. 把十个组件按顺序摆好（模板里没有任何 props / emit）；
 *  2. 挂载后把 `<video>` 交给 store，并让它启动；
 *  3. 卸载前让它收摊。
 *
 * ## 为什么用 `document.getElementById` 而不是 `$refs`
 *
 * store 里 24 处 `videoEl()` 都在等这个元素，而 `$refs` 是组件实例的东西，
 * store 拿不到。想让 ref 进 store 就得在每次渲染后同步一次（`$refs` 不是响应式的），
 * 反而更容易漏。元素上本来就有 `id="biliVideo"`（CSS 也靠它定位），
 * 挂载时按 id 取一次、卸载时置空，语义最简单。
 *
 * `ref="video"` 保留着没有删 —— 万一以后有地方要拿实例内的 ref，不用再改模板。
 *
 * ## 全局样式不在这个文件里
 *
 * 主题令牌在 `styles/theme.css`，骨架（`#app` / `#biliVideo`）与 `el-dialog` 覆盖在
 * `styles/global.css`，由 `main.ts` 在 element-plus 的 css 之后引入。
 * 之前它们是非 scoped 的 `<style>` 挂在 App.vue 末尾（170 行），
 * 让这个「装配壳」同时兼任全局样式表，改名、搬文件都得先越过那一大段。
 */
export default defineComponent({
  name: 'App',
  components: {
    biliVideoControls,
    SongVideoListDialog,
    AppTitlebar,
    BufferOverlay,
    CornerButtons,
    PlaylistManager,
    SettingsDialog,
    AboutDialog,
    AddVideoDialog,
    SleepTimerPanel,
  },
  setup() {
    const playback = usePlaybackStore();

    onMounted(() => {
      /**
       * 先交元素再启动
       *
       * `bootstrap()` 里第一件事是 `init()`，它会读上一首的续播位置并写进
       * `<video>`；元素不在就等于白跑一次。顺序不能反。
       */
      boot.attachVideo(document.getElementById('biliVideo') as unknown as VideoElement | null);
      boot.bootstrap();
    });

    onBeforeUnmount(() => {
      /**
       * 先 `teardown()` 再松开元素
       *
       * `teardown()` 里有几处要操作元素（停 MSE、清预热流），
       * 先置空的话那几步就走不到了，留下悬空的 MediaSource。
       */
      boot.teardown();
      boot.attachVideo(null);
    });

    return { playback };
  },
});
</script>
