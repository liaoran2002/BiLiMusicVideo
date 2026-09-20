<template>
  <div id="biliVideoControls">
    <div class="now-playing">
      <!-- 封面：优先歌曲专辑图，退回视频缩略图 -->
      <div class="np-cover">
        <img
          v-if="coverUrl && !coverFailed"
          :src="coverUrl"
          alt=""
          referrerpolicy="no-referrer"
          @error="coverFailed = true"
        />
        <div v-else class="np-cover-fallback">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 12V4l7-1.5V10"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle cx="4.5" cy="12" r="1.8" stroke="currentColor" stroke-width="1.2" />
            <circle cx="11.5" cy="10" r="1.8" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </div>
      </div>
      <div class="np-text">
        <div class="videoName-container">
          <div :class="['videoName-scroll', paused ? 'paused' : '']">
            <span v-html="videoName"></span>
            <span v-html="videoName"></span>
          </div>
        </div>
        <div v-if="subtitle || quality || audioQuality" class="np-sub">
          <div class="np-subtitle" :title="subtitle">{{ subtitle }}</div>
          <!--
            清晰度 / 音质角标：贴在这一行最右边，点开可以切换
            可选档位由父组件从 playurl 响应里取（不同视频、不同账号能选的档位不一样）
          -->
          <el-dropdown
            v-if="quality"
            trigger="click"
            placement="top"
            @command="(id: number) => $emit('selectQuality', 'video', id)"
          >
            <div class="np-quality" :title="qualityTitle">
              {{ quality }}<span v-if="videoChoices.length > 1" class="np-caret">▾</span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="opt in videoChoices"
                  :key="opt.id"
                  :command="opt.id"
                  :disabled="opt.id === currentQn"
                >
                  画质 · {{ opt.description }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown
            v-if="audioQuality"
            trigger="click"
            placement="top"
            @command="(id: number) => $emit('selectQuality', 'audio', id)"
          >
            <div class="np-quality" :title="audioTitle">
              {{ audioQuality }}<span v-if="audioChoices.length > 1" class="np-caret">▾</span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="opt in audioChoices"
                  :key="opt.id"
                  :command="opt.id"
                  :disabled="opt.id === currentAudioId"
                >
                  音质 · {{ opt.description }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
    <div id="controls">
      <i
        :class="[
          'iconfont',
          listType == 'list' ? 'icon-cuowu' : 'icon-yinleliebiao',
        ]"
        @click="$emit('videoControl', 'list')"
        id="list"
      ></i>
      <i
        :class="[
          'iconfont',
          listType == 'vList' ? 'icon-cuowu' : 'icon-bofangliebiao',
        ]"
        @click="$emit('videoControl', 'vList')"
        id="vList"
      ></i>
      <i
        class="iconfont icon-play-previous"
        @click="$emit('videoControl', 'before')"
        id="before"
      ></i>
      <i
        :class="['iconfont', paused ? 'icon-play' : 'icon-pause']"
        @click="$emit('videoControl', 'playControls')"
        id="playControls"
      ></i>
      <i
        class="iconfont icon-play-next"
        @click="$emit('videoControl', 'next')"
        id="next"
      ></i>
      <div class="audio-control">
        <i
          :class="['iconfont', isMuted ? 'icon-sound-off' : 'icon-sound-on']"
          @click="toggleMute"
          id="sound"
        ></i>
        <div
          :class="['volume-slider', isSoundDragging ? 'show' : '']"
          id="volume-slider"
        >
          <div
            class="volume-track"
            id="volume-track"
            @pointerdown.prevent="onVolumeDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
          >
            <div
              class="volume-progress"
              id="volumeProgress"
              :style="{
                height:
                  (isSoundDragging ? draggingVolume : currentVolume) + '%',
              }"
            ></div>
            <div
              class="volume-thumb"
              id="volumeThumb"
              :style="{
                bottom:
                  (isSoundDragging ? draggingVolume : currentVolume) + '%',
              }"
            ></div>
          </div>
          <div class="volume-number" id="volume-number">
            {{ isSoundDragging ? draggingVolume : currentVolume }}
          </div>
        </div>
      </div>
      <i
        :class="[
          'iconfont',
          currentMode
            ? currentMode == 1
              ? 'icon-danquxunhuan'
              : 'icon-ziyuanldpi'
            : 'icon-shunxubofang',
        ]"
        @click="$emit('videoControl', 'playMode')"
        id="playMode"
      ></i>
    </div>
    <div class="progressContainer">
      <div class="time" id="currentTime">
        {{ formatTime(isVideoDragging ? draggingTime : currentTime) }}
      </div>
      <div
        class="progressWrapper"
        id="progressContainer"
        @pointerdown.prevent="onProgressDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      >
        <div
          class="progressBar"
          :style="{ width: progress * 100 + '%' }"
          id="progressBar"
        >
          <div class="progressHandle" id="progressHandle"></div>
        </div>
      </div>
      <div class="time" id="totalTime">{{ formatTime(duration) }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import type { QualityOptionPayload, QualityOptionsPayload } from '@common/types/ipc';
import { normalizeImageUrl } from '../utils/image';

/** 组件对外派发的事件（与模板里的 $emit 一一对应） */
export interface VideoControlEmits {
  (e: 'changeVolume', volume: number): void;
  (e: 'changeTime', time: number): void;
  (e: 'videoControl', action: string): void;
  (e: 'showList', listType: string): void;
  /** 用户点击了静音按钮（只上报动作，不决定音量） */
  (e: 'toggleMute'): void;
}

export default defineComponent({
  name: 'biliVideoControls',
  emits: [
    'changeVolume',
    'changeTime',
    'videoControl',
    'showList',
    'toggleMute',
    /** 用户在角标菜单里选了清晰度（'video'）或音质（'audio'） */
    'selectQuality',
  ],
  data() {
    return {
      isVideoDragging: false,
      isSoundDragging: false,
      draggingTime: 0,
      draggingVolume: 0,
      activeEl: null as HTMLElement | null,
      /**
       * 当前封面是否加载失败
       *
       * 必须用响应式状态而不是 `img.style.display = 'none'`：
       * 直接改内联样式后，切歌时 Vue 只会 patch `src`（模板里没有 style 绑定），
       * 那个 display:none 永远不会被清掉 —— 一次加载失败，封面就再也出不来了。
       */
      coverFailed: false,
    };
  },
  props: {
    videoName: { type: String, default: '' },
    /** 当前封面（歌曲专辑图或视频缩略图） */
    cover: { type: String, default: '' },
    /** 副标题：歌曲名 - 歌手 · 专辑 */
    subtitle: { type: String, default: '' },
    /** 正在播的视频清晰度标签（例如 1080P / 4K），为空则不显示 */
    quality: { type: String, default: '' },
    /** 清晰度 + 分辨率，用于悬浮提示，例如 1080P（1920×1080） */
    qualityDetail: { type: String, default: '' },
    /** 正在播的音频流音质（例如 192K），为空则不显示 */
    audioQuality: { type: String, default: '' },
    /** 音质悬浮提示，例如 192K 高音质 */
    audioQualityDetail: { type: String, default: '' },
    /** 这个视频当前可选的清晰度 / 音质 */
    qualityOptions: {
      type: Object as () => QualityOptionsPayload | null,
      default: null,
    },
    /** 当前实际在播的清晰度代码（qn）；durl 时为空 */
    videoQn: { type: Number as unknown as () => number | null, default: null },
    /** 当前实际在播的音频流 id；durl 时为空 */
    audioId: { type: Number as unknown as () => number | null, default: null },
    currentMode: { type: Number, default: 0 },
    currentVolume: { type: Number, default: 0 },
    isMuted: { type: Boolean, default: false },
    currentTime: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    paused: { type: Boolean, default: false },
    listType: { type: String, default: '' },
  },
  methods: {
    formatTime(s: number): string {
      s = Math.floor(s || 0);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      const p = (n: number): string => (n < 10 ? '0' + n : String(n));
      return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
    },
    /**
     * 静音按钮
     *
     * 这里只负责「上报用户按了静音」，具体是静音还是恢复、
     * 恢复到多少音量，都交给父组件决定 —— 因为音量状态的权威在 App 那边。
     *
     * 之前这里用 draggingVolume 当「静音前的音量」暂存：
     * 但 draggingVolume 只在拖动音量条时才被赋值，点击静音时它还是初始值 0，
     * 于是「解除静音」恢复的音量是 0，音量永远回不来，静音状态也卡死。
     */
    toggleMute() {
      this.$emit('toggleMute');
    },
    onProgressDown(e: PointerEvent) {
      this.isVideoDragging = true;
      this.activeEl = e.currentTarget as HTMLElement;
      this.activeEl.setPointerCapture(e.pointerId);
      this.calcProgress(e);
    },
    onVolumeDown(e: PointerEvent) {
      this.isSoundDragging = true;
      this.activeEl = e.currentTarget as HTMLElement;
      this.activeEl.setPointerCapture(e.pointerId);
      this.calcVolume(e);
    },
    onPointerMove(e: PointerEvent) {
      if (this.isVideoDragging) this.calcProgress(e);
      else if (this.isSoundDragging) this.calcVolume(e);
    },
    onPointerUp(e: PointerEvent) {
      if (this.activeEl) {
        try {
          this.activeEl.releasePointerCapture(e.pointerId);
        } catch {
          /* 指针可能已经释放，忽略 */
        }
        this.activeEl = null;
      }
      if (this.isVideoDragging) {
        this.isVideoDragging = false;
      }
      if (this.isSoundDragging) {
        this.isSoundDragging = false;
      }
    },
    calcProgress(e: PointerEvent) {
      const el =
        this.activeEl ||
        (this.$el as HTMLElement).querySelector<HTMLElement>('#progressContainer');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pos = Math.min(Math.max(0, (e.clientX - rect.left) / rect.width), 1);
      this.draggingTime = pos * this.duration;
      this.$emit('changeTime', this.draggingTime);
    },
    calcVolume(e: PointerEvent) {
      const el =
        this.activeEl ||
        (this.$el as HTMLElement).querySelector<HTMLElement>('#volume-track');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const y = rect.bottom - e.clientY;
      const pct = Math.min(Math.max(0, y / rect.height), 1);
      this.draggingVolume = Math.round(pct * 100);
      this.$emit('changeVolume', this.draggingVolume);
    },
  },
  computed: {
    /** 封面地址（规整成绝对 https，避免协议相对 URL 在 file:// 下坏掉） */
    coverUrl(): string {
      return normalizeImageUrl(this.cover) ?? '';
    },
    /** 可选清晰度列表 */
    videoChoices(): QualityOptionPayload[] {
      return this.qualityOptions?.video ?? [];
    },
    /** 可选音质列表 */
    audioChoices(): QualityOptionPayload[] {
      return this.qualityOptions?.audio ?? [];
    },
    /**
     * 当前在播的清晰度代码
     *
     * 优先用主进程给的 `videoQn`；durl 兜底时没有 dash 信息，
     * 就按展示名反查（菜单里用来把当前项置灰）。
     */
    currentQn(): number | null {
      if (typeof this.videoQn === 'number') return this.videoQn;
      return this.videoChoices.find((o) => o.label === this.quality)?.id ?? null;
    },
    /** 当前在播的音频流 id（同 currentQn，durl 时回退按标签反查） */
    currentAudioId(): number | null {
      if (typeof this.audioId === 'number') return this.audioId;
      return this.audioChoices.find((o) => o.label === this.audioQuality)?.id ?? null;
    },
    qualityTitle(): string {
      const base = `视频清晰度：${this.qualityDetail || this.quality}`;
      return this.videoChoices.length > 1 ? `${base}（点击切换）` : base;
    },
    audioTitle(): string {
      const base = `音质：${this.audioQualityDetail || this.audioQuality}`;
      return this.audioChoices.length > 1 ? `${base}（点击切换）` : base;
    },
    progress(): number {
      return (
        (this.isVideoDragging ? this.draggingTime : this.currentTime) /
        (this.duration || 1)
      );
    },
  },
  watch: {
    /** 换封面就把失败标记清掉，给新地址一次机会 */
    coverUrl(): void {
      this.coverFailed = false;
    },
  },
});
</script>

<style>
#biliVideoControls {
  color: white;
  position: fixed;
  bottom: 5%;
  left: 50%;
  user-select: none;
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  padding: 20px;
  min-width: 10vw;
  max-width: 50vw;
  transform: translate(-50%, 0%);
  opacity: 0.1;
  transition: all 0.5s ease-in-out;
  font-size: 5vh;
}
#biliVideoControls:hover {
  opacity: 1;
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 10px rgba(0, 0, 0, 0.5);
}
.videoName-container {
  overflow: hidden;
  white-space: nowrap;
  position: relative;
  width: 100%;
}
.videoName-scroll {
  display: inline-flex;
  gap: 5em;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
  animation: scroll-left 10s linear infinite;
}
.videoName-scroll.paused {
  animation-play-state: paused;
}
.videoName-container:hover .videoName-scroll {
  animation-play-state: paused;
}
.videoName-scroll span {
  white-space: nowrap;
}
@keyframes scroll-left {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(calc(-50% - 1.5em));
  }
}
#controls {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
}
#controls i {
  font-size: 10vh;
  height: 10vh;
  line-height: 10vh;
}
.audio-control {
  position: relative;
  display: inline-block;
  cursor: pointer;
}
.audio-control .volume-slider {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 30px;
  height: 120px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 4px;
  padding: 8px 5px;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s,
    visibility 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 8px;
}
.audio-control:hover .volume-slider {
  opacity: 1;
  visibility: visible;
}
.show {
  opacity: 1 !important;
  visibility: visible !important;
}
.volume-track {
  width: 4px;
  height: 100%;
  background: rgba(255, 255, 255, 0.3);
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  position: relative;
  touch-action: none;
}
.volume-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 70%;
  background: white;
  border-radius: 2px;
  transition: height 0.1s ease;
}
.volume-thumb {
  position: absolute;
  left: 50%;
  bottom: 70%;
  transform: translate(-50%, 50%);
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
  transition: bottom 0.1s ease;
}
.volume-number {
  font-size: 2vh;
}
.time {
  font-size: 14px;
  min-width: 60px;
  text-align: center;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
}
.progressContainer {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 5px;
  margin-top: 15px;
  position: relative;
}
.progressWrapper {
  flex: 1;
  height: 5px;
  background-color: rgba(255, 255, 255, 0.3);
  position: relative;
  touch-action: none;
  cursor: pointer;
}
.progressBar {
  height: 100%;
  background-color: rgba(255, 255, 255, 0.8);
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
  position: relative;
}
.progressHandle {
  position: absolute;
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  width: 15px;
  height: 15px;
  background-color: #fff;
  border-radius: 50%;
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
  display: none;
}
#biliVideoControls:hover .progressHandle {
  display: block;
}
/* #region 当前播放（封面 + 标题 + 副标题） */
.now-playing {
  display: flex;
  align-items: center;
  gap: 0.28em;
  /* 关键：给 flex 行明确上限 + min-width:0，
     否则里面的封面会被标题行拉伸（实测曾被撑到 800x65，整条控件栏高达 349px） */
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.np-cover {
  flex: 0 0 auto;
  /* 只管高度，宽度按原图比例自适应；左右留白、图片居中 */
  height: 1.3em;
  min-height: 34px;
  max-height: 58px;
  min-width: 1.3em;
  padding: 0 0.12em;
  border-radius: 0.16em;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}
.np-cover img {
  height: 100%;
  width: auto;
  max-width: 4em;
  object-fit: contain;
  display: block;
}
.np-cover-fallback {
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}
.np-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}
.np-sub {
  display: flex;
  align-items: center;
  gap: 0.4em;
  min-width: 0;
  margin-top: 0.04em;
  font-size: 0.4em;
  line-height: 1.3;
}
/* el-dropdown 的包裹元素默认 inline-block，这里让它不参与收缩 */
.np-sub :deep(.el-dropdown) {
  flex: 0 0 auto;
}
.np-subtitle {
  flex: 1 1 auto;
  min-width: 0;
  color: rgba(255, 255, 255, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
}
/* 清晰度 / 音质小标签：不参与收缩，永远贴在最右边；点开是切换菜单 */
.np-quality {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.18em;
  font-size: 0.92em;
  line-height: 1;
  padding: 0.24em 0.5em;
  border-radius: 0.35em;
  color: #fff;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.4);
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
}
.np-quality:hover {
  background: rgba(255, 255, 255, 0.34);
}
.np-caret {
  font-size: 0.8em;
  opacity: 0.8;
  transform: translateY(-0.05em);
}
/* #endregion */
</style>
