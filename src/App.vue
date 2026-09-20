<template>
  <div id="app">
    <div class="titlebar">
      <!-- 左侧：歌单入口（原「设置歌单」按钮已并入这里） -->
      <div class="titlebar-left">
        <PlaylistPanel @switch="onPlaylistSwitch" @manage="playlistManagerVisible = true" />
      </div>
      <!-- 中间：拖拽区 -->
      <div class="titlebar-drag"
        @mousedown="onTitlebarMouseDown"
        @dblclick="onTitlebarDblClick"
      ></div>
      <!-- 右侧：壁纸 / 头像 / 设置 / 窗口按钮 -->
      <div class="titlebar-right">
        <div class="titlebar-btn" @click="toggleWallpaper">
          {{ wallpaperEnabled ? '应用程序' : '桌面壁纸' }}
        </div>
        <div class="user-info" @click="handleLogoutConfirm">
          <img
            v-if="userFace"
            :src="userFace"
            class="user-avatar"
            referrerpolicy="no-referrer"
          />
          <span class="user-name">{{ userName || '未登录' }}</span>
        </div>
        <div class="win-btn" @click="settingsVisible = true" title="设置">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
              stroke="currentColor"
              stroke-width="1.2"
            />
            <path
              d="M13 8c0-.3 0-.6-.1-.9l1.3-1-1.3-2.2-1.5.6a4.9 4.9 0 0 0-1.5-.9L9.7 2H7.1l-.2 1.6c-.6.2-1.1.5-1.6.9l-1.5-.6L2.5 6.1l1.3 1a5.4 5.4 0 0 0 0 1.8l-1.3 1 1.3 2.2 1.5-.6c.4.4 1 .7 1.6.9l.2 1.6h2.6l.2-1.6c.6-.2 1.1-.5 1.5-.9l1.5.6 1.3-2.2-1.3-1c.1-.3.1-.6.1-.9Z"
              stroke="currentColor"
              stroke-width="1.1"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div
          class="win-btn"
          @click="winMinimize"
          title="最小化"
          v-if="!wallpaperEnabled"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect y="5" width="12" height="1" fill="currentColor" />
          </svg>
        </div>
        <div
          class="win-btn"
          @click="winMaximize"
          :title="isMaximized || isFullscreen ? '向下还原' : '最大化'"
          v-if="!wallpaperEnabled"
        >
          <svg
            v-if="!(isMaximized || isFullscreen)"
            width="12"
            height="12"
            viewBox="0 0 12 12"
          >
            <rect
              x="1"
              y="1"
              width="10"
              height="10"
              rx="1"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 12 12">
            <rect
              x="2.5"
              y="3.5"
              width="7"
              height="7"
              rx="0.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
            <path
              d="M4 3.5V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H8"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
          </svg>
        </div>
        <div class="win-btn win-close" @click="winClose" title="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M1 1L11 11M1 11L11 1"
              stroke="currentColor"
              stroke-width="1.2"
            />
          </svg>
        </div>
      </div>
    </div>

    <!-- src 不绑在模板上：durl 直接用 URL，dash 需要挂 MediaSource，
         统一由 applyVideoSource() 设置，免得两条路互相覆盖 -->
    <video
      id="biliVideo"
      ref="video"
      @canplay="videoCanPlay"
      @loadeddata="onVideoLoaded"
      @timeupdate="videoUpDate"
      @ended="videoEnded"
      @error="videoError"
      @play="onVideoPlayStateChange"
      @pause="onVideoPlayStateChange"
    ></video>
    <showList
      :listType="listType"
      :title="listType == 'list' ? listName : songName"
      :list="listType == 'list' ? songs : videoList"
      :currentIndex="listType == 'list' ? currentIndex : currentVideoIndex"
      @showList="showList"
      @changeSong="changeSong"
      @changeVideo="changeVideo"
    ></showList>
    <biliVideoControls
      :videoName="videoName || songName"
      :cover="currentCover() || ''"
      :subtitle="controlsSubtitle"
      :quality="videoQuality"
      :qualityDetail="videoQualityDetail"
      :audioQuality="audioQuality"
      :audioQualityDetail="audioQualityDetail"
      :qualityOptions="qualityOptions"
      :videoQn="currentVideoQn"
      :audioId="currentAudioId"
      @selectQuality="switchQuality"
      :currentMode="currentMode"
      :currentVolume="currentVolume"
      :isMuted="isMuted"
      :currentTime="currentTime"
      :duration="duration"
      :paused="paused"
      :listType="listType"
      @videoControl="videoControl"
      @changeTime="changeTime"
      @changeVolume="changeVolume"
      @toggleMute="toggleMute"
    ></biliVideoControls>

    <div
      class="fullscreen-btn"
      @click="toggleFullscreen"
      v-if="!wallpaperEnabled"
      :title="isFullscreen ? '退出全屏' : '全屏'"
    >
      <svg
        v-if="!isFullscreen"
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
      >
        <path
          d="M3 7V3H7M13 3H17V7M17 13V17H13M7 17H3V13"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg v-else width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M7 3V7H3M17 7H13V3M13 17V13H17M3 13H7V17"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <!-- 歌单管理：新建 / 编辑 / 同步 / 曲目浏览全部在这一个弹窗里 -->
    <PlaylistManager
      v-model="playlistManagerVisible"
      :current-playlist-id="playlistsStore.currentId || ''"
      :current-index="currentIndex"
      @switch="onPlaylistSwitch"
      @play="onPlayFromManager"
    />

    <!-- 设置 -->
    <SettingsDialog v-model="settingsVisible" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import type { AppSetting } from '@common/types/app_setting';
import defaultSetting from '@common/defaultSetting';
import { PLAY_LOOP_MODES } from '@common/constants';
import biliVideoControls from './components/biliVideoControls.vue';
import showList from './components/showList.vue';
import PlaylistPanel from './components/PlaylistPanel.vue';
import PlaylistManager from './components/PlaylistManager.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import electronApi from './api/electron';
import { useSettingStore } from './stores/setting';
import { usePlaylistStore } from './stores/playlists';
import type { SyncResult, PlaylistSong as StructuredSong } from '@common/types/playlist';
import { toSearchKey } from '@common/types/playlist';
import { normalizeImageUrl } from './utils/image';
import { qualityLabelOf } from './utils/videoQuality';
import { DashSession } from './utils/dashPlayer';
import type { DashStreamsPayload, QualityOptionsPayload } from '@common/types/ipc';
import type {
  AppData,
  BiliVideo,
  ListType,
  VideoControlAction,
  VideoElement,
} from './types/app';

export default defineComponent({
  name: 'App',
  components: { biliVideoControls, showList, PlaylistPanel, PlaylistManager, SettingsDialog },
  setup() {
    // Pinia 只做渲染进程的响应式副本；真正的持久化在主进程。
    // 注意 setup() 会在 options 的 data/computed/methods 之前执行，
    // 所以这里存下的 store 实例在 init() / mounted() 里可以直接用。
    const settingStore = useSettingStore();
    const playlistsStore = usePlaylistStore();
    return { settingStore, playlistsStore };
  },
  computed: {
    /**
     * 关键词加权配置直接读 store，不再在组件里硬编码一份。
     *
     * 注意命名：这里**不能**叫 `tagBonus`。
     * options API 里 computed 的优先级高于 methods，一旦重名，
     * 下面 `tagBonus(title)` 这个方法就会被同名 computed 覆盖，
     * 调用时抛 "this.tagBonus is not a function"。
     */
    tagBonusConfig(): AppSetting['player.tagBonus'] {
      return this.settingStore.tagBonus;
    },
    /** 当前播放歌曲的结构化信息（供详情弹窗右侧与 SMTC 使用） */
    currentSong(): StructuredSong | null {
      return this.songs[this.currentIndex] ?? null;
    },
    /** 播放控制栏副标题：歌曲名 - 歌手 · 专辑 */
    controlsSubtitle(): string {
      const song = this.currentSong;
      if (!song) return '';
      // 缺失的部分直接不出现，避免留下「- · 」这种空占位
      const head = [song.name, song.singer].filter((x): x is string => !!x).join(' - ');
      return [head, song.album].filter((x): x is string => !!x).join(' · ');
    },
    /** 清晰度角标的悬浮提示：完整描述 + 实际解码分辨率 */
    videoQualityDetail(): string {
      if (!this.videoQuality) return '';
      const head = this.videoQualityDesc || this.videoQuality;
      return this.videoQualityPixels ? `${head}（${this.videoQualityPixels}）` : head;
    },
    /** 音质角标的悬浮提示 */
    audioQualityDetail(): string {
      if (!this.audioQuality) return '';
      return this.audioQualityDesc || this.audioQuality;
    },
    /** 当前实际在播的清晰度代码；durl 兜底时没有 dash 信息，返回 null */
    currentVideoQn(): number | null {
      return this.dashSource?.videoId ?? null;
    },
    /** 当前实际在播的音频流 id；durl 兜底时为 null */
    currentAudioId(): number | null {
      return this.dashSource?.audioId ?? null;
    },
  },
  data(): AppData {
    return {
      songs: [],
      videoList: [],
      /**
       * `videoList` 属于哪一首歌（搜索键）
       *
       * `changeSong` 会立刻把 `songName` 切成新歌，但 `videoList` 要等搜索
       * 回来才换。用这个字段标明列表的归属，避免拿上一首的视频干新歌的事。
       */
      videoListKeyword: '',
      /**
       * 正在播的那个视频的封面（主进程回传）
       *
       * 不能只靠 `videoList` 里查：`selectedBvid` 可能不在本次搜索结果里，
       * 而且缓存里的条目可能缺 `pic`，那时封面就空了。
       */
      videoPic: '',
      /** 正在播的视频清晰度短标签（playurl 响应报的档位），例如 1080P */
      videoQuality: '',
      /** 清晰度完整描述（playurl 的 new_description），例如 1080P 高清 */
      videoQualityDesc: '',
      /** `<video>` 实际解码出的分辨率，仅用于悬浮提示交叉印证 */
      videoQualityPixels: '',
      /** 正在播的音频流音质（playurl 响应报的档位），例如 192K */
      audioQuality: '',
      /** 音质完整描述，例如 192K 高音质 */
      audioQualityDesc: '',
      /** 这个视频当前可选的清晰度 / 音质（播放器上的切换菜单用） */
      qualityOptions: null as QualityOptionsPayload | null,
      /** 本次会话手动选过的清晰度（null 表示用设置里的默认值） */
      selectedQn: null as number | null,
      /** 本次会话手动选过的音质 */
      selectedAudioId: null as number | null,
      videoUrl: '',
      /** dash 双轨信息（非空时用 MSE 播放，取不到高清时才退回 durl） */
      dashSource: null as DashStreamsPayload | null,
      /** 正在播的视频 bvid（`currentVideoIndex` 可能是 -1，所以单独记一个） */
      currentBvid: '',
      randomList: [],
      currentIndex: 0,
      currentVideoIndex: 0,
      MODE: { read: 0, single: 1, random: 2 },
      currentMode: 0,
      videoName: '',
      songName: '',
      listName: '',
      currentVolume: 70,
      currentTime: 0,
      duration: 0,
      isMuted: false,
      paused: false,
      listType: 'none',
      /** 歌单管理弹窗（新建/编辑/同步/曲目浏览都在里面） */
      playlistManagerVisible: false,
      isMaximized: false,
      isFullscreen: false,
      wallpaperEnabled: false,
      isDragging: false,
      dragStarted: false,
      dragReady: false,
      dragStartX: 0,
      dragStartY: 0,
      dragOffsetX: 0,
      dragOffsetY: 0,
      _pendingMoveX: 0,
      _pendingMoveY: 0,
      _moveFramePending: false,
      _songToken: 0,
      isLoggedIn: false,
      userFace: '',
      userName: '',
      removeMaximizedListener: null,
      removeFullscreenListener: null,
      removeLoginListener: null,
      removeLogoutListener: null,
      removeTrayPlayControl: null,
      removeTrayPrev: null,
      removeTrayNext: null,
      removeTrayToggleMode: null,
      removeTrayShowPlaylist: null,
      removeTrayShowLogoutConfirm: null,
      removeWallpaperState: null,
      lastNonZeroVolume: 0,
      /** 设置弹窗 */
      settingsVisible: false,
      /** 视频请求竞态令牌（切视频时防乱序覆盖） */
      _videoToken: 0,
      /** 同一个视频的连续失败次数，达到上限就跳过该曲，避免无限重试 */
      _videoErrorCount: 0,
      /** 当前 dash 会话（MSE），不参与渲染所以放实例字段 */
      _dashSession: null as DashSession | null,
      /** dash 连续失败次数，达到阈值就本会话不再尝试 */
      _dashFailures: 0,
      /** 本会话是否已判定 dash 不可用 */
      _dashDisabled: false,
      /** 视频加载完成后要跳转到的秒数（续播用） */
      seekAfterLoad: 0,
      /** 上次写入播放进度的时间戳（节流用） */
      _lastPersistAt: 0,
      /** 上次同步 SMTC 进度的时间戳（节流用） */
      _lastMediaPosAt: 0,
      /** 定时自动同步的定时器 */
      _syncTimer: null as ReturnType<typeof setInterval> | null,
    };
  },
  methods: {
    /**
     * 取 <video> 元素
     *
     * Vue 的 $refs 是无类型的，这里统一收口成一个小工具方法，
     * 避免每处都写 (this.$refs.video as HTMLVideoElement)。
     */
    videoEl(): VideoElement | null {
      return (this.$refs.video as VideoElement | undefined) ?? null;
    },
    /** 统一把 unknown 类型的 catch 错误转成可读文案 */
    errMsg(err: unknown): string {
      return err instanceof Error ? err.message : String(err);
    },
    async init(): Promise<void> {
      // 用主进程下发（Pinia 中）的配置初始化本地播放状态
      const cfg = this.settingStore.setting;
      this.currentVolume = cfg['player.volume'];
      this.isMuted = cfg['player.isMute'];
      // 记录初始非零音量，保证「静音 -> 解除」能恢复到本次会话的实际音量
      this.lastNonZeroVolume = cfg['player.volume'] > 0 ? cfg['player.volume'] : defaultSetting['player.volume'];
      this.currentMode = this.loopModeToIndex(cfg['player.loopMode']);

      this.isMaximized = await electronApi.winIsMaximized();
      this.isFullscreen = await electronApi.winIsFullscreen();
      this.loadUserInfo();
      this.syncTrayState();
      // 接上 Windows 系统媒体控件（SMTC）：媒体键 + 系统音量弹窗里的媒体信息
      this.setupMediaSessionActions();
      this.updateMediaSession();

      // 加载歌单集合（旧版单歌单文件已由主进程迁移进集合）
      try {
        await this.playlistsStore.load();
      } catch (err) {
        this.$message.error('加载歌单失败：' + this.errMsg(err));
      }

      // 后台做启动同步，不阻塞续播
      void this.runStartupSync();
      // 按设置启动「定时自动同步」定时器
      this.setupSyncTimer();

      // 优先续播；没有可续播内容时退回「当前歌单的第一首」
      const resumed = await this.tryResume();
      if (!resumed) await this.loadPlaylist();
    },
    /** 启动时按设置自动同步歌单（失败只提示，不打断启动） */
    async runStartupSync(): Promise<void> {
      try {
        const results = await this.playlistsStore.syncOnStartupIfNeeded();
        await this.reportSyncResults(results, '自动同步');
      } catch (err) {
        console.warn('[sync] 启动同步失败', err);
      }
    },
    /**
     * 统一处理同步结果：提示 + 曲目变化后重载当前播放列表
     *
     * 启动同步与定时同步共用，避免两处逻辑漂移。
     */
    async reportSyncResults(
      results: SyncResult[],
      label: string,
      silentWhenUnchanged = false,
    ): Promise<void> {
      if (!results || results.length === 0) return;
      const failed = results.filter((r) => !r.ok);
      const okList = results.filter((r) => r.ok);
      const changed = okList.filter((r) => (r.added ?? 0) > 0 || (r.removed ?? 0) > 0);

      if (okList.length > 0) {
        if (changed.length === 0 && silentWhenUnchanged) {
          // 定时同步无变化时不打扰用户，只留控制台记录
          console.log(`[sync] ${label}：${okList.length} 个歌单无变化`);
        } else {
          const detail = changed
            .map((r) => `${r.name} +${r.added ?? 0}/-${r.removed ?? 0}`)
            .join('，');
          this.$message.success(
            `${label}完成 ${okList.length} 个` + (detail ? `（${detail}）` : '，无变化'),
          );
        }
      }
      for (const r of failed) {
        this.$message.warning(`${r.name} ${label}失败：${r.error ?? '未知错误'}`);
      }
      // 曲目列表变了：重载当前播放列表，保证播放的不是过期数据
      if (changed.length > 0 && this.songs.length > 0) {
        await this.reloadCurrentPlaylistSongs();
      }
    },
    /**
     * 启动 / 重设「定时自动同步」定时器
     *
     * 策略完全来自每个歌单自己的 sync 配置（设置界面已不再提供全局开关）：
     *  - 只要存在「定时同步」的歌单，就按它们中最小的间隔做心跳
     *  - 每次心跳只同步真正到点的歌单，所以各歌单周期可以不同
     *  - 没有定时歌单时不装定时器，避免空转
     */
    setupSyncTimer(): void {
      this.clearSyncTimer();
      if (!this.playlistsStore.hasIntervalSync) return;
      // 兜底 5 分钟，避免配置成极小值导致疯狂请求
      const interval = Math.max(5 * 60 * 1000, this.playlistsStore.minSyncInterval || 0);
      this._syncTimer = setInterval(() => {
        void this.runIntervalSync();
      }, interval);
      console.log(`[sync] 定时自动同步已启用，心跳间隔 ${Math.round(interval / 60000)} 分钟`);
    },
    clearSyncTimer(): void {
      if (this._syncTimer) {
        clearInterval(this._syncTimer);
        this._syncTimer = null;
      }
    },
    /** 定时心跳：只同步到点的歌单 */
    async runIntervalSync(): Promise<void> {
      // 已有同步在跑就跳过这一轮，避免请求叠加
      if (this.playlistsStore.isSyncing) return;
      const dueIds = this.playlistsStore.getDueSyncIds();
      if (dueIds.length === 0) return;
      try {
        const results = await this.playlistsStore.sync(dueIds);
        // 无变化时静默，避免每次心跳都弹提示
        await this.reportSyncResults(results, '定时同步', true);
      } catch (err) {
        console.warn('[sync] 定时同步失败', err);
      }
    },
    /** 把 store 里当前歌单的曲目同步到本地播放列表（保留当前下标，越界则归零） */
    async reloadCurrentPlaylistSongs(): Promise<void> {
      const record = this.playlistsStore.current;
      if (!record) return;
      const keepIndex = this.currentIndex;
      this.songs = [...record.songs];
      this.listName = record.name;
      if (this.songs.length === 0) return;
      if (keepIndex >= this.songs.length) {
        this.currentIndex = 0;
        await this.playCurrent();
      }
    },
    /**
     * 续播：恢复上次的歌单 / 歌曲 / 视频 / 播放进度
     *
     * @returns 是否成功恢复（false 表示调用方应走默认加载流程）
     */
    async tryResume(): Promise<boolean> {
      if (!this.settingStore.setting['player.resumeOnStart']) return false;
      const record = this.playlistsStore.current;
      if (!record || record.songs.length === 0) return false;

      const index = Math.min(Math.max(0, record.lastIndex), record.songs.length - 1);
      this.songs = [...record.songs];
      this.listName = record.name;
      this.currentIndex = index;

      const songName = this.getSongName(index);
      if (!songName) return false;

      const resumeTime = this.settingStore.setting['player.resumeTime'] || 0;
      const useTime = this.settingStore.setting['player.resumePlaybackTime'];

      try {
        if (await this.restoreSongVideo(songName, useTime ? resumeTime : 0)) {
          this.$message.success(
            `已续播《${this.listName}》第 ${index + 1} 首` +
              (useTime && resumeTime > 3 ? `（${this.formatTime(resumeTime)}）` : ''),
          );
          return true;
        }
      } catch (err) {
        console.warn('[resume] 续播失败，回退到默认流程', err);
      }
      return false;
    },
    /**
     * 恢复某首歌对应的视频
     *
     * 优先用该歌单里记录的「上次选定的视频」（bvId 稳定，能精确回到同一个视频）；
     * 没有记录时才重新搜索匹配。
     *
     * @param seekTo 播放起点（秒），0 表示从头
     * @returns 是否成功
     */
    async restoreSongVideo(songName: string, seekTo = 0): Promise<boolean> {
      const cached = this.playlistsStore.getVideoForSong(songName);
      if (cached) {
        try {
          const res = await electronApi.resolveVideoUrl(cached.bvid, songName);
          if (res.videoUrl || res.dash) {
            this.dashSource = res.dash ?? null;
            this.videoUrl = res.videoUrl ?? '';
            this.applyVideoSource();
            this.currentBvid = cached.bvid;
            // 标题/封面优先用主进程回传的：歌单里的记录可能是旧版本写坏的空值
            this.videoName = res.title || cached.title || '';
            this.videoPic =
              normalizeImageUrl(res.pic ?? null) ||
              normalizeImageUrl(cached.cover ?? null) ||
              '';
            this.videoQuality = res.quality ?? '';
            this.videoQualityDesc = res.qualityDesc ?? '';
            this.audioQuality = res.audioQuality ?? '';
            this.audioQualityDesc = res.audioQualityDesc ?? '';
            this.qualityOptions = res.options ?? null;
            this.songName = songName;
            this.videoList = [
              {
                bvid: cached.bvid,
                title: this.videoName,
                pic: this.videoPic || null,
              },
            ];
            this.videoListKeyword = songName;
            this.currentVideoIndex = 0;
            this.seekAfterLoad = seekTo;
            // 旧版本可能把标题/封面写成空值，顺手修好，免得一直续播成「无标题」
            if (!cached.title || !cached.cover) {
              void this.recordCurrentVideo(cached.bvid, songName, this.videoName, this.videoPic);
            }
            return true;
          }
        } catch (err) {
          console.warn('[resume] 已记录的视频失效，改为重新匹配', err);
        }
      }
      // 回退：重新搜索并匹配
      return false;
    },
    /** 循环模式：字符串枚举 -> 数字下标（供 biliVideoControls 使用） */
    loopModeToIndex(mode: AppSetting['player.loopMode']): number {
      const idx = PLAY_LOOP_MODES.indexOf(mode);
      return idx >= 0 ? idx : this.MODE.read;
    },
    async loadUserInfo(): Promise<void> {
      try {
        const info = await electronApi.getUserInfo();
        this.userFace = info.face;
        this.userName = info.name;
        this.isLoggedIn = true;
        electronApi.setLoggedIn(true);
      } catch {
        this.isLoggedIn = false;
        this.userFace = '';
        this.userName = '';
        electronApi.setLoggedIn(false);
      }
    },
    /**
     * 登录成功后的收尾
     *
     * 1. 刷头像/昵称；
     * 2. **用新的登录态重新解析当前视频的播放地址** ——
     *    未登录时平台只会给低清晰度（实测 360P 档），登录后同一个 bvid 能给到 720P+。
     *    不主动重取的话，得等切到下一首（甚至重启）才看得到变化，
     *    表现就是「登录了跟没登录一样」。
     */
    async onLoggedIn(): Promise<void> {
      await this.loadUserInfo();
      const bvid = this.currentBvid;
      if (!bvid) return;
      // 重新解析会换 URL，视频会重新加载，先把进度记下来
      const resumeAt = this.currentTime;
      if (resumeAt > 3) this.seekAfterLoad = resumeAt;
      this.$message.success('登录成功，正在用更高清晰度重新加载当前视频');
      await this.changeVideo(bvid, this.videoListKeyword || this.songName, { skipCache: true });
    },
    handleLogoutConfirm(): void {
      if (!this.isLoggedIn) {
        this.startLogin();
        return;
      }
      this.$confirm('确定要退出登录吗?', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      })
        .then(() => {
          this.doLogout();
        })
        .catch(() => {});
    },
    async doLogout(): Promise<void> {
      this.userFace = '';
      this.userName = '';
      this.isLoggedIn = false;
      electronApi.setLoggedIn(false);
      await electronApi.executeLogout();
    },
    async toggleWallpaper(): Promise<void> {
      this.wallpaperEnabled = await electronApi.wallpaperToggle();
    },
    async startLogin(): Promise<void> {
      await electronApi.startLogin();
    },
    /**
     * 加载当前歌单的曲目
     *
     * 多歌单之后，曲目来源是 playlists store 的「当前歌单」，
     * 不再直接读旧版单歌单文件（那个文件已由主进程迁移进集合）。
     */
    async loadPlaylist(): Promise<void> {
      const record = this.playlistsStore.current;
      if (record && record.songs.length > 0) {
        this.listName = record.name;
        this.songs = [...record.songs];
        // 回到该歌单上次播放的位置
        const savedIndex = record.lastIndex;
        this.currentIndex =
          savedIndex >= 0 && savedIndex < this.songs.length ? savedIndex : 0;
        // 兼顾「播放进度」：走这条兜底路径时（没有已缓存的视频可精确还原）
        // 也要把上次的秒数带上，否则换歌单/首启场景会丢掉进度
        const cfg = this.settingStore.setting;
        const resumeTime =
          cfg['player.resumeOnStart'] && cfg['player.resumePlaybackTime']
            ? Number(cfg['player.resumeTime']) || 0
            : 0;
        void this.playCurrent(resumeTime > 3 ? resumeTime : 0);
        return;
      }
      // 没有任何歌单：直接打开歌单管理，让用户在里面新建
      this.playlistManagerVisible = true;
    },
    /** 从歌单管理弹窗里点某首歌播放
     *
     * 弹窗内部已负责把该歌单设为当前，这里只需加载曲目并起播。
     */
    async onPlayFromManager(index: number): Promise<void> {
      const record = this.playlistsStore.current;
      if (!record || record.songs.length === 0) return;
      this.songs = [...record.songs];
      this.listName = record.name;
      this.currentIndex = Math.min(Math.max(0, index), this.songs.length - 1);
      this.seekAfterLoad = 0;
      this.videoList = [];
      this.videoListKeyword = '';
      this.videoUrl = '';
      this.dashSource = null;
      this.currentBvid = '';
      this.stopDashSession();
      this.videoName = '';
      this.videoPic = '';
      this.videoQuality = '';
      this.videoQualityDesc = '';
      this.audioQuality = '';
      this.audioQualityDesc = '';
      this.qualityOptions = null;
      this.videoQualityPixels = '';
      this.songName = '';
      void this.playCurrent();
    },
    /** 从歌单面板切换歌单 */
    async onPlaylistSwitch(id: string | null): Promise<void> {
      if (!id) {
        // 歌单被删光了
        this.songs = [];
        this.videoList = [];
        this.videoListKeyword = '';
        this.videoUrl = '';
      this.dashSource = null;
      this.currentBvid = '';
      this.stopDashSession();
        this.listName = '';
        this.currentIndex = 0;
        this.currentVideoIndex = 0;
        this.videoName = '';
        this.videoPic = '';
        this.videoQuality = '';
      this.videoQualityDesc = '';
      this.audioQuality = '';
      this.audioQualityDesc = '';
      this.qualityOptions = null;
      this.videoQualityPixels = '';
        this.songName = '';
        this.playlistManagerVisible = true;
        return;
      }
      const record = this.playlistsStore.current;
      if (!record) return;

      // 换歌单时把进度重置，避免把上一个歌单的秒数带到新歌单
      this.songs = [...record.songs];
      this.listName = record.name;
      this.currentIndex =
        record.lastIndex >= 0 && record.lastIndex < this.songs.length ? record.lastIndex : 0;
      this.videoList = [];
      this.videoListKeyword = '';
      this.currentVideoIndex = 0;
      this.videoUrl = '';
      this.dashSource = null;
      this.currentBvid = '';
      this.stopDashSession();
      this.videoName = '';
      this.videoPic = '';
      this.videoQuality = '';
      this.videoQualityDesc = '';
      this.audioQuality = '';
      this.audioQualityDesc = '';
      this.qualityOptions = null;
      this.videoQualityPixels = '';
      this.songName = '';
      this.currentTime = 0;
      this.seekAfterLoad = 0;
      await this.settingStore.update({
        'player.playIndex': this.currentIndex,
        'player.resumeTime': 0,
      });

      if (this.songs.length === 0) {
        this.$message.warning(`《${record.name}》还没有曲目，可以先「同步」一下`);
        return;
      }
      this.$message.success(`已切换到《${record.name}》（${this.songs.length} 首）`);
      void this.playCurrent();
    },
    playCurrent(seekTo = 0): void {
      if (this.songs.length === 0) return;
      // 续播时把起播点传给 changeSong，视频加载完成后会 seek 过去
      if (seekTo > 0) this.seekAfterLoad = seekTo;
      this.changeSong(this.currentIndex);
      this.resetRandomList();
      // 记录当前播放信息（歌单 / 下标 / 进度）
      void this.persistPlaybackState();
      this.$nextTick(() => {
        const v = this.videoEl();
        if (v) {
          v.volume = this.currentVolume / 100;
        }
      });
    },
    winMinimize(): void {
      electronApi.winMinimize();
    },
    winMaximize(): void {
      if (this.isFullscreen) this.toggleFullscreen();
      else electronApi.winMaximize();
    },
    winClose(): void {
      electronApi.winClose();
    },
    onTitlebarMouseDown(e: MouseEvent): void {
      if (e.button !== 0 || this.wallpaperEnabled) return;
      this.isDragging = true;
      this.dragStarted = false;
      this.dragReady = false;
      this.dragStartX = e.screenX;
      this.dragStartY = e.screenY;
    },
    onTitlebarDblClick(e: MouseEvent): void {
      if (e.button !== 0 || this.wallpaperEnabled) return;
      this.isDragging = false;
      electronApi.winMaximize();
    },
    onDocMouseMove(e: MouseEvent): void {
      if (!this.isDragging) return;
      if (!this.dragStarted) {
        const dx = Math.abs(e.screenX - this.dragStartX);
        const dy = Math.abs(e.screenY - this.dragStartY);
        if (dx < 5 && dy < 5) return;
        this.dragStarted = true;
        this.dragReady = false;
        electronApi.winStartDrag().then((info) => {
          if (info) {
            this.dragOffsetX = info.offsetX;
            this.dragOffsetY = info.offsetY;
            this.dragReady = true;
          }
        });
        return;
      }
      if (!this.dragReady) return;
      this._pendingMoveX = e.screenX - this.dragOffsetX;
      this._pendingMoveY = e.screenY - this.dragOffsetY;
      if (!this._moveFramePending) {
        this._moveFramePending = true;
        requestAnimationFrame(() => {
          this._moveFramePending = false;
          electronApi.winMoveWindow(this._pendingMoveX, this._pendingMoveY);
        });
      }
    },
    onDocMouseUp(e: MouseEvent): void {
      if (!this.isDragging) return;
      this.isDragging = false;
      if (this.dragStarted && this.dragReady) {
        electronApi.winGetScreenWorkArea().then((workArea) => {
          if (workArea && e.screenY <= workArea.y + 8 && !this.isMaximized) {
            electronApi.winMaximize();
          }
        });
      }
    },
    async toggleFullscreen(): Promise<void> {
      this.isFullscreen = await electronApi.winToggleFullscreen();
      this.$message.info(
        this.isFullscreen
          ? '进入全屏,按esc或F键可以退出全屏'
          : '退出全屏,按F键可以再次进入全屏',
      );
    },
    videoCanPlay(): void {},
    /**
     * 视频加载失败
     *
     * 修复要点：原来是无条件 `changeVideo(..., true)` 重试，没有计数上限，
     * 一旦解析始终失败就是死循环。这里加失败计数：
     *  - 先跳过缓存重试一次（原意图）
     *  - 仍失败则跳到下一首，并提示用户
     */
    async videoError(): Promise<void> {
      // 切歌时 this.songName 立刻变成新歌，但 videoList 还是上一首的；
      // 这段窗口里旧视频元素报错不能算在新歌头上（否则会拿旧 bvid 重试，
      // 甚至把旧视频永久记到新歌名下），直接忽略。
      if (this.videoListKeyword !== this.songName) return;

      /**
       * dash（MSE）出错时先退回 durl，别直接判成「视频加载失败」。
       *
       * MSE 的失败面比单文件播放宽得多（编码不支持、某个分片拉取失败、
       * buffer quota 超限……），这些都不代表视频本身坏了。
       * 退回 720P 混流至少能正常看，比跳歌好得多。
       */
      if (this.dashSource) {
        this._videoErrorCount = 0;
        this.$message.warning('高清（dash）流播放失败，已自动切回 720P');
        this.fallbackToDurl();
        return;
      }

      this._videoErrorCount += 1;
      const video = this.videoList[this.currentVideoIndex];
      if (this._videoErrorCount === 1 && video) {
        // 第一次失败：跳过缓存重新解析该视频
        await this.changeVideo(video.bvid, this.videoListKeyword, { skipCache: true });
        return;
      }
      this._videoErrorCount = 0;
      this.$message.warning(`《${this.songName || '当前歌曲'}》视频加载失败，已跳过`);
      if (this.songs.length > 1) this.next();
    },
    onVideoLoaded(): void {
      const v = this.videoEl();
      if (v) {
        v.volume = this.currentVolume / 100;
        // 关键修复：原来只在 isMuted 为真时写 true，解除静音后不会写回 false，
        // 导致「图标显示有声、实际没声」。这里始终跟随当前状态赋值。
        v.muted = this.isMuted;
        // 续播：加载完成后再 seek，否则会被随后的加载覆盖
        if (this.seekAfterLoad > 0) {
          const target = this.seekAfterLoad;
          this.seekAfterLoad = 0;
          try {
            v.currentTime = target;
          } catch {
            /* 某些格式不支持 seek，忽略 */
          }
        }
        this._videoErrorCount = 0;
        void v.play().catch(() => {});
        this.paused = false;
        // dash（MSE）成功出画：清掉失败计数
        if (this.dashSource) this._dashFailures = 0;
        this.syncVideoQuality();
        this.syncTrayState();
        // 记录当前播放信息，供下次续播
        void this.persistPlaybackState();
        // 更新系统媒体控件（歌名/歌手/专辑/封面 + 播放状态）
        this.updateMediaSession();
        this.updateMediaPosition();
      }
    },
    /** 播放/暂停状态变化时同步给系统媒体控件 */
    onVideoPlayStateChange(): void {
      this.updateMediaSession();
    },
    videoUpDate(): void {
      const v = this.videoEl();
      if (!v) return;
      this.currentTime = v.currentTime;
      this.duration = v.duration;
      // 少数源在 loadeddata 时尺寸还没就绪，这里补一次（拿到就不再重复算）
      if (!this.videoQuality) this.syncVideoQuality();
      // 节流记录播放进度，供下次续播
      this.persistPlaybackStateThrottled();
      // 同步系统媒体控件的进度条
      this.updateMediaPositionThrottled();
    },
    /**
     * 记录 `<video>` 实际解码出来的分辨率
     *
     * 纯粹用来在悬浮提示里交叉印证 playurl 报的清晰度
     * （平台偶尔会出现「报 720P、实际给 1080P 帧」这种情况，
     * 摆在提示里总比藏着好）。
     * 顺带在 playurl 没给清晰度时，按分辨率兜底一个标签。
     */
    syncVideoQuality(): void {
      const v = this.videoEl();
      if (!v || !v.videoWidth || !v.videoHeight) return;
      this.videoQualityPixels = `${v.videoWidth}×${v.videoHeight}`;
      if (!this.videoQuality) {
        this.videoQuality = qualityLabelOf(v.videoWidth, v.videoHeight);
      }
    },
    videoEnded(): void {
      if (this.currentMode == this.MODE.single) {
        this.currentTime = 0;
      } else {
        this.next();
      }
    },
    videoControl(event: VideoControlAction): void {
      switch (event) {
        case 'list':
        case 'vList':
          this.showList(event);
          break;
        case 'before':
          this.prev();
          break;
        case 'next':
          this.next();
          break;
        case 'playControls':
          this.playControl();
          break;
        case 'playMode':
          this.toggleMode();
          break;
      }
    },
    showList(event: ListType): void {
      this.listType = this.listType == event ? 'none' : event;
    },
    playControl(): void {
      const v = this.videoEl();
      if (!v) return;
      if (this.paused) void v.play();
      else v.pause();
      this.paused = !this.paused;
      this.syncTrayState();
    },
    changeTime(time: number): void {
      const v = this.videoEl();
      if (!v) return;
      if (this.paused) {
        void v.play();
        this.paused = false;
      }
      v.currentTime = time;
    },
    changeVolume(volume: number): void {
      // 记住最后一个非零音量，供「解除静音」恢复使用。
      // 不能用子组件的 draggingVolume —— 那个只在拖动时才更新，
      // 点击静音时还停在初始值 0，会把音量"恢复"成 0。
      if (volume > 0) this.lastNonZeroVolume = volume;
      this.isMuted = volume == 0;
      // <video> 的 volume/muted 统一由上面的 settingStore watcher 落地，
      // 这里不重复写，避免两处状态不同步
      this.currentVolume = volume;
      // 用户改动音量 -> 写回主进程持久化（音量与静音状态一起写，保证两者不矛盾）
      this.settingStore.update({
        'player.volume': volume,
        'player.isMute': this.isMuted,
      });
    },
    /**
     * 静音 / 解除静音
     *
     * 由本组件决定音量（因为音量状态的权威在这里），
     * 子组件只负责上报「用户点了静音」。
     */
    toggleMute(): void {
      if (this.isMuted) {
        // 恢复：优先用上次的非零音量；没有历史就用默认音量，
        // 避免"恢复成 0"导致音量再也回不来
        const fallback = defaultSetting['player.volume'];
        const restore = this.lastNonZeroVolume > 0 ? this.lastNonZeroVolume : fallback;
        this.changeVolume(restore);
        this.$message.success(`音量: ${restore}`);
      } else {
        this.changeVolume(0);
        this.$message.success('已静音');
      }
    },
    formatTime(s: number): string {
      s = Math.floor(s || 0);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      const p = (n: number): string => (n < 10 ? '0' + n : String(n));
      return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
    },
    handleKeydown(e: KeyboardEvent): void {
      if (e.target instanceof HTMLElement) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      }
      if (this.wallpaperEnabled) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.playControl();
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.changeVolume(Math.min(100, this.currentVolume + 5));
          this.$message.success(`当前音量:${this.currentVolume}`);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.changeVolume(Math.max(0, this.currentVolume - 5));
          this.$message.success(`当前音量:${this.currentVolume}`);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (this.duration) {
            this.changeTime(Math.min(this.duration, this.currentTime + 5));
            this.$message.success(
              `${this.formatTime(this.currentTime)}/${this.formatTime(this.duration)}`,
            );
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.changeTime(Math.max(0, this.currentTime - 5));
          this.$message.success(
            `${this.formatTime(this.currentTime)}/${this.formatTime(this.duration)}`,
          );
          break;
        case 'KeyF':
          e.preventDefault();
          this.toggleFullscreen();
          break;
        case 'Escape':
          e.preventDefault();
          if (this.isFullscreen) this.toggleFullscreen();
          break;
      }
    },
    async changeSong(index: number): Promise<void> {
      const songName = this.getSongName(index);
      if (!songName) return;
      const token = ++this._songToken;

      // 先把「只依赖本地歌单」的信息立刻切过去。
      //
      // 歌曲名、专辑封面、歌单高亮全都能就地取到，不需要网络；
      // 原来它们排在 `await searchSong()` 后面，于是要等一次搜索往返
      // （缓存未命中时是 1~3 秒的真网络请求，失败就一直不回来）——
      // 表现就是「切了歌，播放器里的歌曲图片和名称还是上一首的」。
      this.currentIndex = index;
      this.songName = songName;
      // 视频信息属于上一首，先清掉：标题回退成歌名（见模板的 videoName || songName），
      // 等搜索回来再换成真正的视频标题，绝不显示成「新歌配旧视频标题」
      this.videoName = '';
      this.videoPic = '';
      this.videoQuality = '';
      this.videoQualityDesc = '';
      this.audioQuality = '';
      this.audioQualityDesc = '';
      this.qualityOptions = null;
      this.videoQualityPixels = '';

      try {
        const res = await electronApi.searchSong(songName);
        if (token !== this._songToken) return;
        // searchSong 的 data 形状由搜索接口决定，这里收敛成 BiliVideo
        const videos = (res.data as { result?: BiliVideo[] } | null)?.result ?? [];
        const keywords = songName.replace(/-/g, '').trim();
        const parts = songName.split('-').map((s) => s.trim());
        const realSongName = parts[0] || '';
        const artistName = parts[1] || '';
        videos.sort((a, b) => {
          const sa =
            this.matchScore(a.title, keywords) +
            this.nameBonus(a.title, realSongName, artistName);
          const sb =
            this.matchScore(b.title, keywords) +
            this.nameBonus(b.title, realSongName, artistName);
          return sb + this.tagBonus(b.title) - (sa + this.tagBonus(a.title));
        });
        this.videoList = videos;
        this.videoListKeyword = songName;
        if (videos.length > 0) {
          const selectedBvid =
            (res.data as { selectedBvid?: string } | null)?.selectedBvid || videos[0].bvid;
          await this.changeVideo(selectedBvid, songName);
        } else {
          this.$message.warning(`《${songName}》未找到视频`);
        }
      } catch (err) {
        if (token !== this._songToken) return;
        this.$message.error(`《${songName}》${this.errMsg(err)}`);
      }
    },
    /**
     * 切换到某个视频
     *
     * 加了竞态保护：快速切歌/切视频时，先发出的请求可能后返回，
     * 没有令牌就会被旧结果覆盖 videoUrl（原实现缺这个保护）。
     */
    async changeVideo(
      bvid: string,
      keyword: string,
      opts: {
        skipCache?: boolean;
        noDash?: boolean;
        qn?: number;
        audioId?: number;
      } = {},
    ): Promise<void> {
      const token = ++this._videoToken;
      try {
        const res = await electronApi.resolveVideoUrl(
          bvid,
          keyword,
          opts.skipCache ?? false,
          opts.noDash || this._dashDisabled,
          // 本次会话里手动选过的优先；没选过就交给主进程用设置里的默认值
          opts.qn ?? this.selectedQn ?? undefined,
          opts.audioId ?? this.selectedAudioId ?? undefined,
        );
        if (token !== this._videoToken) return; // 已有更新的请求，丢弃本次结果
        this.currentBvid = bvid;
        // dash 双轨（1080P+，需要 MSE 合成）与 durl（720P 混流）二选一
        this.dashSource = res.dash ?? null;
        this.videoUrl = res.videoUrl ?? '';
        this.applyVideoSource();
        const idx = this.videoList.findIndex((item) => item.bvid === bvid);
        // 找不到就置 -1：selectedBvid 是历史选择，可能不在本次搜索结果里。
        // 置 -1 后列表不会把别的条目误标成「正在播放」。
        this.currentVideoIndex = idx;
        const video = this.videoList[idx];
        // 标题/封面以主进程回传的为准（它解析的就是正在播的这个视频），
        // 列表项只作兜底：缓存里可能还留着旧版本写坏的、缺 title/pic 的条目。
        this.videoName = res.title || video?.title || '';
        this.videoPic =
          normalizeImageUrl(res.pic ?? null) ||
          normalizeImageUrl(video?.pic ?? null) ||
          '';
        // 清晰度 / 音质只认 playurl 响应自己报的档位（不是请求参数里的 qn）
        this.videoQuality = res.quality ?? '';
        this.videoQualityDesc = res.qualityDesc ?? '';
        this.audioQuality = res.audioQuality ?? '';
        this.audioQualityDesc = res.audioQualityDesc ?? '';
        // 这个视频此刻可选的档位（切换菜单用）
        this.qualityOptions = res.options ?? null;
        // 记录「这首歌选了哪个视频」，下次续播可直接精确还原
        void this.recordCurrentVideo(bvid, keyword, this.videoName, this.videoPic);
      } catch (err) {
        if (token !== this._videoToken) return;
        this.$message.error(this.errMsg(err));
      }
    },
    /**
     * 手动切换清晰度 / 音质
     *
     * 选择只作用于**本次会话**（`selectedQn` / `selectedAudioId`），
     * 不改设置里的默认值 —— 默认值在设置界面里改。
     * 重新解析会换掉流地址，所以先把播放进度记下来。
     */
    async switchQuality(kind: 'video' | 'audio', id: number): Promise<void> {
      if (kind === 'video') this.selectedQn = id;
      else this.selectedAudioId = id;

      const bvid = this.currentBvid;
      if (!bvid) return;
      const resumeAt = this.currentTime;
      if (resumeAt > 1) this.seekAfterLoad = resumeAt;
      await this.changeVideo(bvid, this.videoListKeyword || this.songName, {
        skipCache: true,
      });
    },
    /**
     * 把当前的 dash / durl 结果挂到 `<video>` 上
     *
     * dash 走 MSE：B 站 dash 的音视频是两条独立的流，只给一条会没声音，
     * 所以由 DashSession 把两轨都塞进同一个 MediaSource；
     * 编码不支持或播放失败就自动退回 durl（720P 混流）。
     */
    applyVideoSource(): void {
      const el = this.videoEl();
      if (!el) return;
      this.stopDashSession();

      const dash = this.dashSource;
      if (dash && DashSession.isSupported(dash)) {
        const session = new DashSession(el);
        this._dashSession = session;
        session
          .start(dash)
          .catch((err) => {
            // 期间已经换过源（切歌 / 换视频）就忽略这次失败
            if (this._dashSession !== session) return;
            console.warn('[video] dash 播放失败，退回 durl:', err);
            this.fallbackToDurl();
          });
        return;
      }

      if (dash && !DashSession.isSupported(dash)) {
        console.warn('[video] 当前环境不支持该 dash 编码，改用 durl');
      }
      if (this.videoUrl) el.src = this.videoUrl;
    },
    stopDashSession(): void {
      if (this._dashSession) {
        this._dashSession.stop();
        this._dashSession = null;
      }
    },
    /**
     * dash（MSE）失败后退回 durl
     *
     * 注意不能在本地把 `videoUrl` 拿来用 —— 走 dash 时主进程回的
     * `videoUrl` 是 null（它没有额外去要 durl），所以必须重新解析一次。
     * 连续失败两次就认为这台机器上 dash 不可用，本会话不再尝试，
     * 免得每切一首歌都白跑一次 dash。
     */
    fallbackToDurl(): void {
      this.stopDashSession();
      this.dashSource = null;
      this._dashFailures += 1;
      if (this._dashFailures >= 2) {
        this._dashDisabled = true;
        console.warn('[video] dash 连续失败，本会话改用 durl');
      }
      const bvid = this.currentBvid;
      if (!bvid) return;
      void this.changeVideo(bvid, this.videoListKeyword || this.songName, {
        skipCache: true,
        noDash: true,
      });
    },
    /**
     * 当前歌曲对应的视频封面（B 站缩略图）
     *
     * 优先用正在播放的那个视频的缩略图，其次用该歌在 videoCache 里记住的封面。
     */
    currentVideoCover(): string | null {
      // 正在播的那个视频的缩略图：主进程随播放地址一起回传，最可靠
      const own = normalizeImageUrl(this.videoPic || null);
      if (own) return own;
      const v =
        this.videoList[this.currentVideoIndex] ??
        this.videoList.find((item) => item.bvid && item.title === this.videoName);
      const pic = normalizeImageUrl(v?.pic ?? null);
      if (pic) return pic;
      const cached = normalizeImageUrl(
        this.songName ? this.playlistsStore.getVideoForSong(this.songName)?.cover : null,
      );
      return cached;
    },
    /** 当前歌曲的封面：优先平台专辑图，退回视频缩略图 */
    currentCover(): string | null {
      const song = this.getSong(this.currentIndex);
      const own = normalizeImageUrl(song?.cover ?? null);
      if (own) return own;
      return this.currentVideoCover();
    },
    /**
     * 更新 Windows 系统媒体控件（SMTC）
     *
     * 渲染进程用的是标准 Media Session API，Electron 在 Windows 上会把它桥接到
     * 系统的 SMTC：系统音量弹窗 / 锁屏界面 / 键盘媒体键都会用到这里的信息。
     * artwork 就是「歌曲图片 / 视频图片」在系统那边的呈现。
     */
    updateMediaSession(): void {
      const ms = navigator.mediaSession;
      if (!ms) return;
      const song = this.getSong(this.currentIndex);
      const title = song?.name || this.videoName || this.songName || 'B站音乐视频';
      const artist = song?.singer || this.userName || '未知歌手';
      const album = song?.album || this.listName || '';

      // 封面：平台专辑图 -> 视频缩略图，两个尺寸都给，系统会挑合适的
      const cover = this.currentCover();
      const artwork = cover
        ? [
            { src: cover, sizes: '256x256', type: 'image/jpeg' },
            { src: cover, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [];

      try {
        ms.metadata = new MediaMetadata({
          title,
          artist,
          album,
          artwork,
        });
        // 同步播放/暂停状态，否则系统控件按钮会显示错
        ms.playbackState = this.paused ? 'paused' : 'playing';
      } catch (err) {
        console.warn('[smtc] 更新媒体信息失败', err);
      }
    },
    /** 同步播放进度到系统控件（有则显示进度条） */
    updateMediaPosition(): void {
      const ms = navigator.mediaSession;
      if (!ms || typeof ms.setPositionState !== 'function') return;
      if (!Number.isFinite(this.duration) || this.duration <= 0) return;
      try {
        ms.setPositionState({
          duration: this.duration,
          position: Math.min(Math.max(0, this.currentTime), this.duration),
          playbackRate: 1,
        });
      } catch {
        /* 进度参数不合法时忽略（例如刚切歌 duration 还是 0） */
      }
    },
    /** 注册系统媒体键的处理（播放/暂停/上下曲） */
    setupMediaSessionActions(): void {
      const ms = navigator.mediaSession;
      if (!ms) return;
      const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
        ['play', () => { if (this.paused) this.playControl(); }],
        ['pause', () => { if (!this.paused) this.playControl(); }],
        ['nexttrack', () => this.next()],
        ['previoustrack', () => this.prev()],
        ['seekbackward', () => this.changeTime(Math.max(0, this.currentTime - 10))],
        ['seekforward', () => this.changeTime(Math.min(this.duration || 0, this.currentTime + 10))],
      ];
      for (const [action, handler] of handlers) {
        try {
          ms.setActionHandler(action, handler);
        } catch {
          /* 个别 action 不支持时跳过 */
        }
      }
    },

    /** 把当前选定的视频写进歌单（用于续播精确还原）
     *
     * @param song  「这首歌」的搜索键。由调用方显式传入而不是读 this.songName，
     *              因为切歌后 this.songName 已经是新歌，而这次解析可能属于上一首。
     * @param title 正在播的视频标题（主进程回传）
     * @param cover 正在播的视频封面（主进程回传）
     */
    async recordCurrentVideo(
      bvid: string,
      song: string,
      title = '',
      cover = '',
    ): Promise<void> {
      if (!song || !bvid) return;
      const hit = this.videoList.find((v) => v.bvid === bvid);
      // 已有的记录不要被空值覆盖：写坏一次就会一直续播成「无标题、无封面」
      const existing = this.playlistsStore.getVideoForSong(song);
      const finalTitle = title || hit?.title || existing?.title || '';
      const finalCover =
        cover || normalizeImageUrl(hit?.pic ?? null) || existing?.cover || null;
      try {
        await this.playlistsStore.setVideoForSong(song, {
          bvid,
          title: finalTitle,
          // 一并记住封面（规整成绝对 https），续播时列表里也能显示缩略图
          cover: finalCover,
        });
      } catch (err) {
        console.warn('[playlist] 记录视频失败', err);
      }
    },
    /**
     * 记录当前播放信息（歌单 / 歌曲下标 / 视频 / 进度）
     *
     * 触发点：切歌、切视频、视频加载完成、时间更新（节流）。
     */
    async persistPlaybackState(): Promise<void> {
      const record = this.playlistsStore.current;
      if (!record) return;
      const patch: Partial<AppSetting> = {
        'player.playIndex': this.currentIndex,
        'player.resumeTime': Math.floor(this.currentTime || 0),
      };
      void this.settingStore.update(patch);
      // 歌单自己的下标（切歌单时用于回到各自的位置）
      void this.playlistsStore.setLastIndex(this.currentIndex);
    },
    /** 节流记录进度，避免 timeupdate 每秒写多次 */
    persistPlaybackStateThrottled: function (): void {
      const now = Date.now();
      if (now - this._lastPersistAt < 5000) return;
      this._lastPersistAt = now;
      void this.persistPlaybackState();
    },
    /** 节流同步系统媒体控件的进度（每秒调用太频繁） */
    updateMediaPositionThrottled: function (): void {
      const now = Date.now();
      if (now - this._lastMediaPosAt < 3000) return;
      this._lastMediaPosAt = now;
      this.updateMediaPosition();
    },
    /**
     * 关闭窗口前记录播放信息
     *
     * beforeunload 里不能等异步，所以这里直接发一次 fire-and-forget 的 IPC；
     * 主进程侧有 300ms 防抖并在 before-quit 里 flush，能保证落盘。
     */
    onBeforeUnload(): void {
      const patch: Partial<AppSetting> = {
        'player.playIndex': this.currentIndex,
        'player.resumeTime': Math.floor(this.currentTime || 0),
      };
      this.settingStore.update(patch);
      this.playlistsStore.setLastIndex(this.currentIndex);
    },
    /**
     * 取第 index 首歌的「搜索键」（`"歌名-歌手"`）
     *
     * 匹配打分、搜索缓存 key、videoCache key 全部沿用这个格式，
     * 所以曲目改成结构化对象后，这里统一用 toSearchKey 兼容旧链路。
     */
    getSongName(index: number): string | null {
      if (!this.songs || this.songs.length === 0) return null;
      const song = this.songs[index];
      return song ? toSearchKey(song) : null;
    },
    /** 取第 index 首歌的结构化信息（供界面展示封面/专辑） */
    getSong(index: number): StructuredSong | null {
      return this.songs[index] ?? null;
    },
    matchScore(title: string, keywords: string): number {
      const t = (title || '').replace(/<[^>]*>/g, '').toLowerCase();
      const k = keywords.toLowerCase().replace(/\s/g, '');
      let score = 0;
      let remaining = t;
      for (const ch of k) {
        const idx = remaining.indexOf(ch);
        if (idx !== -1) {
          score++;
          remaining = remaining.slice(0, idx) + remaining.slice(idx + 1);
        }
      }
      return score;
    },
    tagBonus(title: string): number {
      const t = (title || '').replace(/<[^>]*>/g, '');
      let bonus = 0;
      for (const [score, keywords] of Object.entries(this.tagBonusConfig)) {
        for (const kw of keywords) {
          if (t.toLowerCase().includes(kw.toLowerCase())) {
            bonus += Number(score);
          }
        }
      }
      return bonus;
    },
    nameBonus(title: string, songName: string, artistName: string): number {
      if (!title) return 0;
      const t = title.replace(/<[^>]*>/g, '');
      let bonus = 0;
      const songMatch = songName && t.includes(songName);
      const artistMatch = artistName && t.includes(artistName);
      if (songMatch) bonus += 5;
      if (artistMatch) bonus += 3;
      if (songMatch && artistMatch) bonus += 5;
      return bonus;
    },
    next(): void {
      if (!this.songs || this.songs.length === 0) return;
      const index =
        this.currentMode === this.MODE.random
          ? this.getRandomNext()
          : (this.currentIndex + 1) % this.songs.length;
      this.changeSong(index);
    },
    syncTrayState(): void {
      electronApi.trayUpdateState({
        paused: this.paused,
        // 托盘契约用字符串枚举的循环模式（与持久化的 player.loopMode 一致）
        loopMode: PLAY_LOOP_MODES[this.currentMode] || 'listLoop',
      });
    },
    async initWallpaperState(): Promise<void> {
      this.wallpaperEnabled = await electronApi.wallpaperIsEnabled();
    },
    prev(): void {
      if (!this.songs || this.songs.length === 0) return;
      const index =
        this.currentMode === this.MODE.random
          ? this.getRandomPrev()
          : (this.currentIndex - 1 + this.songs.length) % this.songs.length;
      this.changeSong(index);
    },
    toggleMode(): void {
      this.currentMode = (this.currentMode + 1) % 3;
      if (this.currentMode === this.MODE.random) this.resetRandomList();
      // 用户切模式 -> 写回主进程持久化
      this.settingStore.update({
        'player.loopMode': PLAY_LOOP_MODES[this.currentMode] || 'listLoop',
      });
      this.syncTrayState();
    },
    getRandomNext(): number {
      if (this.randomList.length === 0) this.resetRandomList();
      let pos = this.randomList.indexOf(this.currentIndex);
      if (pos === -1) {
        this.randomList.push(this.currentIndex);
        pos = this.randomList.length - 1;
      }
      return this.randomList[(pos + 1) % this.randomList.length];
    },
    getRandomPrev(): number {
      if (this.randomList.length === 0) this.resetRandomList();
      let pos = this.randomList.indexOf(this.currentIndex);
      if (pos === -1) {
        this.randomList.push(this.currentIndex);
        pos = this.randomList.length - 1;
      }
      return this.randomList[
        (pos - 1 + this.randomList.length) % this.randomList.length
      ];
    },
    resetRandomList(): void {
      const indices = Array.from({ length: this.songs.length }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      this.randomList = indices;
      if (this.songs.length > 0) {
        const pos = this.randomList.indexOf(this.currentIndex);
        if (pos === -1) this.randomList.unshift(this.currentIndex);
        else if (pos > 0) {
          this.randomList.splice(pos, 1);
          this.randomList.unshift(this.currentIndex);
        }
      }
    },
  },
  watch: {
    /**
     * 配置可能在别处被改动（多窗口同步、托盘、恢复默认），
     * 所以要把 Pinia 里的音量/静音同步回本地播放状态，并作用到 <video> 上。
     *
     * 用 !== 判断避免与「用户改音量 -> 写回主进程 -> 广播回来」形成回环。
     */
    'settingStore.setting': {
      handler(): void {
        const cfg = this.settingStore.setting;
        if (cfg['player.volume'] !== this.currentVolume) {
          this.currentVolume = cfg['player.volume'];
        }
        if (cfg['player.isMute'] !== this.isMuted) {
          this.isMuted = cfg['player.isMute'];
        }
        const v = this.videoEl();
        if (v) {
          v.volume = this.currentVolume / 100;
          v.muted = this.isMuted;
        }
        // 定时同步策略现在挂在每个歌单上，所以歌单变化也要重建定时器
        this.setupSyncTimer();
      },
      deep: true,
    },
  },
  mounted() {
    // 配置在 src/main.ts 里已经拉取完成，这里直接初始化播放状态
    void this.init();
    this.removeLoginListener = electronApi.onLoginSuccess(() => {
      void this.onLoggedIn();
    });
    this.removeLogoutListener = electronApi.onLogout(() => {
      this.isLoggedIn = false;
      this.userFace = '';
      this.userName = '';
    });
    this.removeTrayPlayControl = electronApi.onTrayPlayControl(() => {
      this.playControl();
    });
    this.removeTrayPrev = electronApi.onTrayPrev(() => {
      this.prev();
    });
    this.removeTrayNext = electronApi.onTrayNext(() => {
      this.next();
    });
    this.removeTrayToggleMode = electronApi.onTrayToggleMode(() => {
      this.toggleMode();
    });
    this.removeTrayShowPlaylist = electronApi.onTrayShowPlaylist(() => {
      // 托盘「设置歌单」-> 直接打开统一的歌单管理弹窗
      this.playlistManagerVisible = true;
    });
    this.removeTrayShowLogoutConfirm = electronApi.onTrayShowLogoutConfirm(
      () => {
        this.handleLogoutConfirm();
      },
    );
    this.removeWallpaperState = electronApi.onWallpaperState((enabled) => {
      this.wallpaperEnabled = enabled;
    });
    this.initWallpaperState();
    this.removeMaximizedListener = electronApi.onMaximized((val) => {
      this.isMaximized = val;
    });
    this.removeFullscreenListener = electronApi.onFullscreen((val) => {
      this.isFullscreen = val;
    });
    document.addEventListener('keydown', this.handleKeydown);
    document.addEventListener('mousemove', this.onDocMouseMove);
    document.addEventListener('mouseup', this.onDocMouseUp);
    // 关闭窗口前记录一次播放信息（用户要求「关闭时」也记录）
    window.addEventListener('beforeunload', this.onBeforeUnload);
  },
  beforeUnmount() {
    this.stopDashSession();
    if (this.removeLoginListener) this.removeLoginListener();
    if (this.removeLogoutListener) this.removeLogoutListener();
    if (this.removeTrayPlayControl) this.removeTrayPlayControl();
    if (this.removeTrayPrev) this.removeTrayPrev();
    if (this.removeTrayNext) this.removeTrayNext();
    if (this.removeTrayToggleMode) this.removeTrayToggleMode();
    if (this.removeTrayShowPlaylist) this.removeTrayShowPlaylist();
    if (this.removeTrayShowLogoutConfirm) this.removeTrayShowLogoutConfirm();
    if (this.removeWallpaperState) this.removeWallpaperState();
    if (this.removeMaximizedListener) this.removeMaximizedListener();
    if (this.removeFullscreenListener) this.removeFullscreenListener();
    document.removeEventListener('keydown', this.handleKeydown);
    document.removeEventListener('mousemove', this.onDocMouseMove);
    document.removeEventListener('mouseup', this.onDocMouseUp);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.clearSyncTimer();
  },
});
</script>

<style>
#app {
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  user-select: none;
}
#biliVideo {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  z-index: 0;
}

.titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  z-index: 200;
  display: flex;
  align-items: center;
}
.titlebar-drag {
  flex: 1;
  height: 100%;
  cursor: default;
}
/* 左侧歌单入口：贴左边缘，与右侧按钮区分开 */
.titlebar-left {
  display: flex;
  align-items: center;
  padding-left: 8px;
  -webkit-app-region: no-drag;
}
.titlebar-right {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 4px;
  -webkit-app-region: no-drag;
}

.titlebar-btn {
  padding: 0 12px;
  margin: 0 6px;
  height: 30px;
  display: flex;
  align-items: center;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.5),
    0 0 8px rgba(0, 0, 0, 0.3);
  transition: background 0.15s;
  white-space: nowrap;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
}
.titlebar-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.5),
    0 0 8px rgba(0, 0, 0, 0.3);
  border-radius: 16px;
  padding: 3px 12px 3px 3px;
  margin-left: 6px;
  transition: background 0.2s;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
}
.user-info:hover {
  background: rgba(255, 255, 255, 0.25);
}
.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.3);
}
.user-name {
  color: white;
  font-size: 13px;
  white-space: nowrap;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.9),
    0 0 8px rgba(0, 0, 0, 0.5);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.win-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-left: 6px;
  color: rgba(255, 255, 255, 0.8);
  transition: background 0.15s;
  border-radius: 4px;
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.5),
    0 0 8px rgba(0, 0, 0, 0.3);
}
.win-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}
.win-close:hover {
  background: #e81123 !important;
  color: white;
}

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
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: all 0.2s;
  opacity: 0.2;
}
.fullscreen-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.3);
}
</style>
