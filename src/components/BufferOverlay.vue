<template>
  <!--
    缓冲提示

    切换清晰度 / 切歌时 MSE 要重新拉流，这段没有任何反馈的话看起来就是「卡死了」。
    这里像视频平台那样给出百分比，明确是「在缓冲」而不是「出问题了」。

    数据全部来自 player store：百分比、圆环长度和副标题都由 store 的 getters 算好。
    口径（起播按 5 秒算分母）属于播放器知识，这里只按 SVG 规则画。
  -->
  <div v-if="playback.buffering" class="buffer-overlay">
    <div class="buffer-ring-wrap">
      <svg class="buffer-ring" viewBox="0 0 36 36">
        <circle class="ring-bg" cx="18" cy="18" r="15.5" />
        <circle
          class="ring-fg"
          cx="18"
          cy="18"
          r="15.5"
          :stroke-dasharray="playback.ringLength"
          :stroke-dashoffset="playback.ringOffset"
        />
      </svg>
      <span class="buffer-percent">{{ playback.bufferPercent }}%</span>
    </div>
    <div class="buffer-text">缓冲中…</div>
    <div class="buffer-sub">{{ playback.bufferSubText }}</div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { usePlaybackStore } from '../stores/playback';

export default defineComponent({
  name: 'BufferOverlay',
  computed: {
        playback() {
      return usePlaybackStore();
    },
  },
});
</script>

<style scoped>
.buffer-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 26px;
  border-radius: 14px;
  /* 刻意压暗的 scrim：缓冲提示要压在视频上，文字再走 --glass-text */
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: var(--glass-text);
  pointer-events: none;
  user-select: none;
}
.buffer-ring-wrap {
  position: relative;
  width: 76px;
  height: 76px;
}
.buffer-ring {
  width: 100%;
  height: 100%;
  /* 从 12 点方向顺时针画 */
  transform: rotate(-90deg);
}
.ring-bg,
.ring-fg {
  fill: none;
  stroke-width: 2.6;
}
.ring-bg {
  stroke: rgba(var(--text-rgb), 0.18);
}
.ring-fg {
  stroke: rgb(var(--text-rgb));
  stroke-linecap: round;
  transition: stroke-dashoffset 0.2s linear;
}
.buffer-percent {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-shadow: var(--glass-shadow);
}
.buffer-text {
  font-size: 13px;
  opacity: 0.92;
}
.buffer-sub {
  font-size: 11px;
  opacity: 0.6;
}
</style>
