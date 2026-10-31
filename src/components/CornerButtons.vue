<template>
  <!--
    右下角全屏按钮 + 左下角锁定按钮

    两个按钮**必须放在一起**：锁定后标题栏、控制栏、歌单入口全被隐藏，
    界面上只剩这两个（没有它们就没法解锁，也没法退全屏），
    所以它们的显示条件（壁纸模式下都隐藏）和样式（同一套毛玻璃）天然是一组。

    抽成组件之前它们是两块互不相干的模板，改样式时要在两个地方各改一遍
    （`.fullscreen-btn` 和 `.corner-btn` 的规则几乎是复制粘贴）。
  -->
  <div
    class="fullscreen-btn"
    @click="window.toggleFullscreen()"
    v-if="!window.wallpaperEnabled"
    :title="window.isFullscreen ? '退出全屏' : '全屏'"
  >
    <i
      class="iconfont"
      :class="window.isFullscreen ? 'icon-suoxiao' : 'icon-full-screen'"
    ></i>
  </div>

  <!--
    锁定按钮
    锁定后把标题栏、控制栏、歌单入口全隐藏，只留左下/右下这两个按钮；
    再点一次（或按 S）解锁。图标字体里没有锁，用内联 SVG。
  -->
  <div
    class="corner-btn lock-btn"
    :class="{ locked: window.locked }"
    @click="window.toggleLock()"
    v-if="!window.wallpaperEnabled"
    :title="window.locked ? '解锁（S）' : '锁定（S）'"
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="4.2" y="8.6" width="11.6" height="8" rx="2" />
      <path v-if="window.locked" d="M7 8.6V6.4a3 3 0 0 1 6 0v2.2" />
      <path v-else d="M7 8.6V6.4a3 3 0 0 1 5.9-.7" />
      <circle cx="10" cy="12.6" r="1" fill="currentColor" stroke="none" />
    </svg>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useWindowStore } from '../stores/window';

export default defineComponent({
  name: 'CornerButtons',
  computed: {
        window() {
      return useWindowStore();
    },
  },
});
</script>

<style scoped>
.fullscreen-btn {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 100;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--glass-text);
  /* 和别的浮层同一套毛玻璃令牌（受设置里的透明度 / 模糊强度控制） */
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  text-shadow: var(--glass-shadow);
  transition: all 0.2s;
  opacity: 0.2;
}
.fullscreen-btn:hover {
  opacity: 1;
  background: var(--glass-bg-strong);
}
.fullscreen-btn .iconfont {
  font-size: 20px;
  line-height: 1;
}

/*
 * 左下角的锁定按钮
 *
 * 和右下角全屏按钮完全同一套外观，只是贴左边；锁定状态下这俩按钮**都要留着**
 * （界面其它部分都藏起来了，没有它们就没法解锁）。
 */
.corner-btn {
  position: fixed;
  bottom: 16px;
  z-index: 100;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--glass-text);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  text-shadow: var(--glass-shadow);
  transition: all 0.2s;
  opacity: 0.2;
}
.corner-btn:hover {
  opacity: 1;
  background: var(--glass-bg-strong);
}
.lock-btn {
  left: 16px;
}
/* 锁着的时候让它明显一点，否则界面上什么都看不到、这个按钮又是半透明的 */
.lock-btn.locked {
  opacity: 0.75;
}
.lock-btn.locked:hover {
  opacity: 1;
}
</style>
