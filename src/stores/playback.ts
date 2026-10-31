import { defineStore } from 'pinia';
import { markRaw, nextTick } from 'vue';
import { DashSession } from '../utils/dashPlayer';
import { ElMessage, ElNotification } from 'element-plus';
import { PLAY_LOOP_MODES, VIDEO_QUALITY_OPTIONS, findQualityOption } from '@common/constants';
import { normalizeImageUrl } from '../utils/image';
import { PREFETCH_AHEAD_S, WARM_MAX_TRIES, WARM_RETRY_DELAY_MS, START_BUFFER_S, LEAD_S, STALL_MS, MAX_QUALITY_DROPS } from './constants';
import { qualityLabelOf } from '../utils/videoQuality';
import type { DashStreamsPayload, QualityOptionsPayload } from '@common/types/ipc';
import type { VideoElement, VideoControlAction, BiliVideo } from '../types/app';
import type { AppSetting } from '@common/types/app_setting';
import defaultSetting from '@common/defaultSetting';
import electronApi from '../api/electron';
import { useQueueStore } from './queue';
import { useUiStore } from './ui';
import { useSessionStore } from './session';
import { useSleepStore } from './sleep';
import { useSettingStore } from './setting';
import { usePlaylistStore } from './playlists';
import type { AppData } from '../types/app';

/**
 * playback store
 *
 * 状态与动作都只属于这一个业务域；跨域访问通过 getter 拿到别的 store 实例。
 * 依赖方向见 ARCHITECTURE.md，不允许成环。
 */
export const usePlaybackStore = defineStore('playback', {
  state: (): Pick<
  AppData,
  'videoPic' | 'videoQuality' | 'videoQualityDesc' | 'videoQualityPixels' | 'audioQuality' | 'audioQualityDesc' | 'qualityOptions' | 'selectedQn' | 'selectedAudioId' | 'videoUrl' | 'dashSource' | 'currentMode' | 'videoName' | 'currentVolume' | 'currentTime' | 'duration' | 'isMuted' | 'paused' | 'trayMenuOpen' | 'lastNonZeroVolume' | '_videoToken' | '_videoErrorCount' | '_dashSession' | '_dashFailures' | '_dashDisabled' | 'seekAfterLoad' | 'seekAfterLoadFor' | 'buffering' | 'bufferPercent' | 'bufferSeconds' | '_bufferTimer' | '_lastPersistAt' | '_lastMediaPosAt' | '_lastTaskbarKey' | '_lastTraySyncAt' | '_endWatchTimer' | '_bufferOverlayTimer' | '_warm' | '_warmed' | '_warming' | '_warmTries' | '_warmFailed' | '_warmRetryAt' | '_warmEl' | '_warmSession' | '_warmTimer' | '_lastProgressAt' | '_progressPos' | '_endStallHandled' | '_stallSince' | '_stallRecoveries' | '_stallGivenUp' | '_stallNoticeOpen' | '_stallUrlIndex' | '_stallQualityDrops' | '_videoHolder'
> => ({


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


  currentMode: 0,


  videoName: '',


  currentVolume: 70,


  currentTime: 0,


  duration: 0,


  isMuted: false,


  paused: false,


  /** 自绘托盘菜单是否正开着（开着时吞掉窗口内点击） */
  trayMenuOpen: false,


  lastNonZeroVolume: 0,


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



  /**
   * `seekAfterLoad` 是为哪一首歌设的
   *
   * 这个字段必须一起带上：`seekAfterLoad` 是跨源共享的，
   * 若切歌后还拿旧的秒数去 seek，短一点的歌会直接被定位到 duration 之外。
   */
  seekAfterLoadFor: '',


  /** 是否正在缓冲（切换清晰度 / 切歌时 MSE 重新拉流的那段） */
  buffering: false,


  /** 缓冲进度百分比（0-100，朝「够播」推进） */
  bufferPercent: 0,


  /** 播放位置之后已缓冲的秒数 */
  bufferSeconds: 0,


  /** 缓冲百分比的定时刷新句柄（只在缓冲期间跑） */
  _bufferTimer: null as ReturnType<typeof setInterval> | null,


  /** 上次写入播放进度的时间戳（节流用） */
  _lastPersistAt: 0,


  /** 上次同步 SMTC 进度的时间戳（节流用） */
  _lastMediaPosAt: 0,


  /** 上次发给任务栏的进度指纹（百分比 + 暂停态），避免每次 timeupdate 都发 IPC */
  _lastTaskbarKey: '',


  /** 上次给托盘菜单推状态的时间（菜单开着时按 300ms 节流） */
  _lastTraySyncAt: 0,


  /** 片尾看门狗：每秒检查一次「缓冲到底但没触发 ended」 */
  _endWatchTimer: null as ReturnType<typeof setInterval> | null,


  /** 换源时延迟显示缓冲提示的定时器 */
  _bufferOverlayTimer: null as ReturnType<typeof setTimeout> | null,


  /** 预热槽位：上一首 / 下一首各一个 */
  _warm: { next: null, prev: null } as AppData['_warm'],



  /**
   * 某个方向是否已经「热」过了
   *
   * 必须有这个标志：预热媒体只拉 2 秒就 `stopWarmMedia()`，而 `_warm[dir]`（接口结果）
   * 还要留着给切歌用 —— 只看 `_warmSession/_warmTimer` 的话，心跳每秒都会认为
   * 「这个方向还没预热」，于是**每 3 秒重建一次 MediaSource 并重新拉流**，
   * 一首歌下来几十次（next/prev 各一份），白白吃带宽和 CPU。
   * 只在 `clearWarm`（切进那首 / 换歌单）里清掉。
   */
  _warmed: { next: false, prev: false },


  _warming: { next: false, prev: false },



  /**
   * 某个方向的预热**失败了几次**（用来实现「重试 3 次、间隔 3 秒」）
   *
   * 为什么需要它：心跳每秒都会调 `warmApi`，而搜不到视频时不能靠 `_warm[dir]`
   * 拦截（那个槽位是空的）—— 没有这个计数就会**每秒重试一次真网络请求**，
   * 一直不停（用户反馈「日志刷了几十行、界面卡住」就是这么来的）。
   *
   * 达到上限后记进 `_warm[dir]`（带 `failed` 标记）彻底停掉，直到换歌才重置。
   */
  _warmTries: { next: 0, prev: 0 },


  /** 某个方向的预热结果是否已彻底失败（不再重试，等换歌清掉） */
  _warmFailed: { next: false, prev: false },


  /** 上次预热失败的时间戳（配合 `WARM_RETRY_DELAY_MS` 实现「间隔 3 秒」） */
  _warmRetryAt: { next: 0, prev: 0 },


  _warmEl: { next: null, prev: null } as AppData['_warmEl'],


  _warmSession: { next: null, prev: null } as AppData['_warmSession'],


  _warmTimer: { next: null, prev: null } as AppData['_warmTimer'],


  /** 播放位置最后一次前进的时间戳 */
  _lastProgressAt: 0,


  /** 最后一次记录到的播放位置（判断有没有前进） */
  _progressPos: 0,


  /** 本次源已经按「播完」处理过，避免看门狗重复触发 */
  _endStallHandled: false,


  /** 停滞看门狗的起始时间戳（0 = 当前没在停滞） */
  _stallSince: 0,


  /** 本次停滞已经恢复过几次（真的开始播了就清零） */
  _stallRecoveries: 0,


  /** 单曲歌单下反复停滞：已放弃这条流，不再周期性告警 */
  _stallGivenUp: false,



  /**
   * 「所有源都卡住」那条**常驻**通知当前是不是还开着
   *
   * 它 `duration: 0`（要手动关），所以必须保证同时只有一条 ——
   * 详见 `recoverFromStall` 步骤 ④ 的说明。
   */
  _stallNoticeOpen: false,


  /** 卡顿恢复链：当前试到第几个备用源（0 = 主地址） */
  _stallUrlIndex: 0,


  /** 卡顿恢复链：已经降了几档清晰度（最多 3 档） */
  _stallQualityDrops: 0,


  _videoHolder: markRaw({ el: null as VideoElement | null }),
  }),
  getters: {
    queueStore: (): ReturnType<typeof useQueueStore> => useQueueStore(),
    uiStore: (): ReturnType<typeof useUiStore> => useUiStore(),
    sessionStore: (): any => useSessionStore(),
    sleepStore: (): any => useSleepStore(),
    settingStore: (): ReturnType<typeof useSettingStore> => useSettingStore(),
    playlistsStore: (): ReturnType<typeof usePlaylistStore> => usePlaylistStore(),

  /** 播放控制栏副标题：歌曲名 - 歌手 · 专辑 */
  controlsSubtitle(): string {
    const song = this.queueStore.currentSong;
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


  /** 缓冲圆环的周长（r = 15.5，SVG viewBox 36x36） */
  ringLength(): number {
    return 2 * Math.PI * 15.5;
  },


  /** 缓冲圆环的绘制偏移：百分比越大画得越满 */
  ringOffset(): number {
    return this.ringLength * (1 - Math.min(100, Math.max(0, this.bufferPercent)) / 100);
  },



  /**
   * 缓冲提示的副标题
   *
   * 把三个阶段分开说清楚，否则「0% 不动」和「99% 卡住」都会让人以为出问题了：
   *  - 还没拿到数据 -> 正在取流
   *  - 数据够了但解码器还没就绪 -> 即将播放
   *  - 其余 -> 报已缓冲秒数
   */
  bufferSubText(): string {
    if (this.bufferSeconds <= 0.05) return '正在获取视频流…';
    if (this.bufferPercent >= 95) return '即将开始播放…';
    return `已缓冲 ${this.bufferSeconds.toFixed(1)} 秒`;
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
  actions: {


  videoControl(event: VideoControlAction): void {
    /*
     * ⚠️ 这里**不需要**再判 `netBusy`
     *
     * 「会发请求」的只有 `before` / `next` 两个动作，而它们最终都会走到
     * `prev()` / `next()` —— 那两个函数**内部**已经统一守住了 `netBusy`
     * （见 `next()` 的注释）。在这里再判一次是重复的，而且容易让人误以为
     * 「守卫只在这个入口有效」。
     *
     * 模板里的 `@click="busy ? null : ..."` 是**另一回事**：那儿只负责
     * 给用户「点不动」的视觉反馈（灰掉 + not-allowed），不承担拦截职责。
     */
    switch (event) {
      case 'list':
      case 'vList':
        this.uiStore.showList(event);
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




  playControl(): void {
    const v = this.videoEl();
    if (!v) return;
    if (this.paused) {
      // play() 的 promise 必须吃掉：换源 / seek 会把它中断成 AbortError，
      // 不 catch 就是一条「Uncaught (in promise)」噪音日志
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
    this.paused = !this.paused;
    this.syncTrayState();
  },




  changeTime(time: number): void {
    const v = this.videoEl();
    if (!v) return;
    if (this.paused) {
      void v.play().catch(() => {});
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
    // 托盘菜单里的音量条要跟着变（菜单开着时）
    this.syncTrayState();
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
      ElMessage.success(`音量: ${restore}`);
    } else {
      this.changeVolume(0);
      ElMessage.success('已静音');
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




  /*
   * `matchScore` / `tagBonus` / `nameBonus` 三个打分函数已**移到主进程**：
   * 见 `@common/utils/videoRank`。它们现在由 `api:searchSong` 在写库前调用，
   * 好让 `videos.ord` 直接等于最终显示顺序。渲染层不再需要它们。
   */
  next(): void {
    if (!this.queueStore.songs || this.queueStore.songs.length === 0) return;

    /**
     * ★ **`netBusy` 时忽略切歌**（统一守卫，所有入口都受保护）
     *
     * 放在 `next()` / `prev()` **内部**而不是每个调用点：
     * 会调它们的有控制栏按钮、托盘菜单、系统媒体键、将来的快捷键 ——
     * 逐个补漏迟早会漏。放在这里，**任何**入口在请求在飞时都点不动。
     *
     * 为什么必须拦：切歌 = 重新搜索 + 解析地址（两个请求）。
     * 连点就是请求成倍叠加，B站直接 412 风控。
     */
    if (this.uiStore.netBusy) {
      this.uiStore.notifyNetBusy();
      return;
    }
    const index =
      this.currentMode === this.queueStore.MODE.random
        ? this.queueStore.getRandomNext()
        : (this.queueStore.currentIndex + 1) % this.queueStore.songs.length;
    this.changeSong(index);
  },




  prev(): void {
    if (!this.queueStore.songs || this.queueStore.songs.length === 0) return;
    /** ★ `netBusy` 时忽略切歌（统一守卫，理由见 `next()` 那段） */
    if (this.uiStore.netBusy) {
      this.uiStore.notifyNetBusy();
      return;
    }
    const index =
      this.currentMode === this.queueStore.MODE.random
        ? this.queueStore.getRandomPrev()
        : (this.queueStore.currentIndex - 1 + this.queueStore.songs.length) % this.queueStore.songs.length;
    this.changeSong(index);
  },




  toggleMode(): void {
    this.currentMode = (this.currentMode + 1) % 3;
    if (this.currentMode === this.queueStore.MODE.random) this.queueStore.resetRandomList();
    // 用户切模式 -> 写回主进程持久化
    this.settingStore.update({
      'player.loopMode': PLAY_LOOP_MODES[this.currentMode] || 'listLoop',
    });
    this.syncTrayState();
  },



  /**
   * （原来这里有个 `sortSearchedVideos()` —— **已删除**）
   *
   * 它曾是渲染层的第二套打分排序，后来被打分排序搬到主进程
   * （`@common/utils/videoRank` 的 `rankVideos`）之后就退化成了恒等函数
   * （`return videos`），只是留着兼容 5 个调用点。现在直接在每个调用点写
   * `videos` 本身，这个空壳一并删掉。
   *
   * ## 为什么必须搬去主进程
   *
   * 原来主进程按「收藏 + B 站顺序」写 `ord`，渲染层拿到后又按打分重排一遍 ——
   * 于是**界面顺序和库里顺序是两套**。「收藏再取消来提升顺序」这种依赖持久化
   * 顺序的用法一重新搜索就散（取消后 `favorites` 变 0、合并时不再保留位置，
   * 它就回到 B 站顺序了）。
   *
   * 现在 `rankVideos` 在**写库之前**执行，`videos.ord` 直接等于最终显示顺序，
   * 搜索返回的列表**已经是排好的** —— 渲染层不再有任何排序逻辑。
   */
  async changeSong(index: number): Promise<void> {
    const songName = this.queueStore.getSongName(index);
    /** 歌名与歌手分开（搜索接口收两个字段，不是一个拼串） */
    const parts = this.queueStore.getSongParts(index);
    if (!songName || !parts) return;
    const token = ++this.queueStore._songToken;

    /**
     * 换歌 = 上一次「手动挑的清晰度 / 音质」作废
     *
     * 控制栏角标上的手动选择只针对**当前这一首**（README 里也是这么写的），
     * 所以换歌时必须清掉，否则上一首临时挑的档位会一直粘到后面每一首 ——
     * 表现就是「我上一首挑了 360P，下一首还是 360P」。
     * 清掉后交给主进程用设置里的默认上限。
     */
    this.selectedQn = null;
    this.selectedAudioId = null;

    // 先把「只依赖本地歌单」的信息立刻切过去。
    //
    // 歌曲名、专辑封面、歌单高亮全都能就地取到，不需要网络；
    // 原来它们排在 `await searchSong()` 后面，于是要等一次搜索往返
    // （缓存未命中时是 1~3 秒的真网络请求，失败就一直不回来）——
    // 表现就是「切了歌，播放器里的歌曲图片和名称还是上一首的」。
    this.queueStore.currentIndex = index;
    this.queueStore.songName = songName;

    /**
     * 视频信息属于上一首，先清掉：
     *
     * - `videoListKeyword` **不能**在这里就跟成新歌：`videoError` 靠
     *   「`videoListKeyword` 是否等于 `songName`」判断这个错误是不是当前这首歌的，
     *   提前改掉会让「上一首的视频报错」被算到新歌头上。
     *   换清晰度 / 退 durl 需要关键字时统一用 `this.queueStore.songName`（它就是缓存键）。
     * - 标题回退成歌名（见模板的 `videoName || songName`），等搜索回来再换成真标题。
     */
    this.queueStore.videoListKeyword = '';
    this.videoName = '';
    this.videoPic = '';
    this.videoQuality = '';
    this.videoQualityDesc = '';
    this.audioQuality = '';
    this.audioQualityDesc = '';
    this.qualityOptions = null;
    this.videoQualityPixels = '';

    /**
     * 上一首的看门狗状态要在这里就作废
     *
     * `changeSong` 之后有一段「搜索 + 解析」的空窗（网络往返可能好几秒），
     * 期间旧 `<video>` 还挂着旧源、1 秒心跳照样在跑：如果旧视频正好卡在最后 2 秒
     * （就是「缓冲到底但没触发 ended」那个已知场景），片尾看门狗会在空窗里命中并
     * `videoEnded() → next()` —— 用户点一次下一首实际跳过两首。
     */
    this._endStallHandled = true;
    this._lastProgressAt = Date.now();
    this._stallSince = 0;
    this._stallRecoveries = 0;

    /**
     * ★ 卡顿**恢复链的两个计数器**也必须在这里归零（踩过）
     *
     * 它们是「当前这条流试到第几个备用源 / 降了几档清晰度」，而切歌意味着
     * **换了一条全新的流** —— 旧计数对新的流没有任何意义。
     *
     * 原来只在 `onVideoLoaded`（真正开始播）里复位，于是有个盲区：
     * 新歌若在 `loadeddata` **之前**就卡住（`checkPlaybackStall` 的
     * `neverStarted` 分支正是为这个场景写的），那次复位永远不会发生。
     * 带着上一首的旧计数执行恢复链的后果：
     *
     * ```
     * _stallUrlIndex=1     → 直接跳到第 3 个备用源，跳过本首歌自己的第 2 个候选
     * _stallQualityDrops=3 → 已到 MAX_QUALITY_DROPS，自动降清晰度对本首**永不生效**
     * ```
     *
     * 也就是「第二首新歌的表现莫名比第一首差很多」。
     */
    this._stallUrlIndex = 0;
    this._stallQualityDrops = 0;
    // 进度也属于上一首：不复位的话 playCurrent 会把上一首的秒数写进 resumeTime，
    // 键盘 / SMTC 拖进度还会拿它去定位新歌
    this.currentTime = 0;
    this.duration = 0;


    /**
     * `selectedBvid`（「这首歌上次播的是哪个视频」）不在这里写。
     *
     * 它由 `api:resolveVideo` 在**每次真正切到某个视频时**落库（一行 upsert）。
     * 换 SQLite 之前之所以要攒到「切歌 / 退出」才写，是因为旧实现是 JSON 文件：
     * 每写一次都要把整份候选列表 stringify 再 rename，切视频那么频繁根本受不了。
     * 现在按主键更新一行，成本和一次 setItem 差不多，所以**每次切视频直接写**，
     * 语义反而更准（不必再担心「切了视频但没切歌就退出」会丢）。
     *
     * 预热（`warmApi`）走的是同一个 `resolveVideoUrl`，而它挑的 bvid 与 `changeSong`
     * 逐字一致，所以它写进去的也是「这首歌该播的那个」，不会写错。
     */

    try {
      const res = await this.uiStore.withNet(() => electronApi.searchSong(parts.song, parts.singer));
      if (token !== this.queueStore._songToken) return;
      // searchSong 的 data 形状由搜索接口决定，这里收敛成 BiliVideo
      const videos = (res.data as { result?: BiliVideo[] } | null)?.result ?? [];

      /**
       * 主进程在「过滤后一条不剩」时会带 `filtered: true`
       *
       * 那表示**搜索本身成功了**，只是所有结果都被过滤规则（标题不含歌名 /
       * 时长对不上 / 命中屏蔽词）挡掉了 —— 这和「搜不到」是两回事，
       * 提示也得分开说（见下面 `notifyFilteredEmpty` / `notifySearchEmpty`）。
       */
      const filteredEmpty = Boolean((res.data as { filtered?: boolean } | null)?.filtered);

      /**
       * 顺序已经是最终顺序 —— 主进程 `rankVideos` **在写库之前**排好的
       * （收藏整段置顶，其余按「歌手名命中 +100」再叠关键词加权）。
       * 渲染层**不再排序**，直接用它给的顺序。
       *
       * 历史上这里有过两套二次排序（`applyFavoriteOrder` / `sortSearchedVideos`），
       * 都已删除 —— 它们和主进程各排一次，必然对不上。
       */
      let list = videos;

      /*
       * ⚠️ 这里**不再重试**（原来最多重试 3 次，已删除）
       *
       * 用户明确要求：「别搞什么重试了，搜索结果为空就提醒用户不要切歌太频繁，
       * B站不会返回空结果的」。
       *
       * 理由很硬：**B站搜索不会对一首正常存在的歌返回 0 条** ——
       * 第 1 轮就空几乎只有一种解释：**被风控了**。
       * 而重试恰恰是在风控状态下继续打请求，只会让封禁更久
       * （原来「4 轮降级 × 3 次重试」最坏能打出二十多个请求，
       * 正是被 412 的元凶）。现在由主进程直接抛 `RateLimitError`，
       * 下面 catch 分支给用户一句准确的提示。
       */

      this.queueStore.videoList = list;
      this.queueStore.videoListKeyword = songName;
      if (this.queueStore.videoList.length > 0) {

        /**
         * 播哪个视频：**优先「上次这首歌播的那个」**
         *
         * 以前读的是搜索返回体里的 `selectedBvid`，那是个 bug 的来源 ——
         * 它由 `api:resolveVideo` 写回，而那个写回要等「真的联网重新解析」才发生
         * （缓存命中时不写）。于是切回上一首歌时读到的往往是**很久以前**那次
         * 解析留下的 bvid，而不是上次真正在播的那个。
         *
         * 现在 `selected_bvid` 由 `api:resolveVideo` 在**每次切到某个视频时**写库
         * （一行 upsert），所以这里读到的就是「上次真正在播的那个」。
         * 搜索返回体里那份仍然兜底读一次 —— 主进程写库后立即返回的新结果会带上它，
         * 少一次 IPC 往返。
         */
        const remembered = await electronApi.getSelectedBvid(songName);
        if (token !== this.queueStore._songToken) return;
        const selectedBvid =
          remembered ||
          (res.data as { selectedBvid?: string } | null)?.selectedBvid ||
          this.queueStore.videoList[0].bvid;
        await this.changeVideo(selectedBvid, songName);
      } else {
        // 还是没有：把上一首的播放状态彻底停掉，别出现「新歌名 + 旧视频在播」
        this.clearNowPlaying();

        /**
         * 提示要分两种情况说 —— 它们**解决办法完全不同**：
         *  - `filteredEmpty`：搜索成功了，只是被**过滤规则**全挡掉了。
         *    解决办法是去设置里放宽规则（过滤词、时长容差），
         *    说「网络有问题」会把用户引到完全错误的方向。
         *  - 否则：搜索真的没结果，才谈网络 / 登录。
         */
        if (filteredEmpty) this.notifyFilteredEmpty(songName);
        else this.notifySearchEmpty(songName);
      }
    } catch (err) {
      if (token !== this.queueStore._songToken) return;
      // 搜索失败：列表清空 + 停掉上一首，别让「视频列表」里还挂着上一首的候选
      this.queueStore.videoList = [];
      this.queueStore.currentVideoIndex = -1;
      this.clearNowPlaying();

      /**
       * 提示要区分「被风控」和「其它失败」—— 两者**解决办法完全不同**
       *
       * 主进程遇到 B站的 **HTTP 412**（或「第 1 轮就返回 0 条」）会抛
       * `RateLimitError`，错误消息里已经写明「切歌太快」。那种情况
       * 说「网络有问题」会把用户引到完全错误的方向 —— 他需要的是**等一会儿**，
       * 而不是去检查网络或重新登录。
       */
      if (this.uiStore.isRateLimitErr(err)) {
        ElNotification({

          /**
           * ⚠️ 文案**不能出现技术细节**（「限流」/「412」/「请求被拦」）
           *
           * 用户会把界面截图发出去。写成「被 B 站限流了」「B 站把请求拦下来了」，
           * 等于把「我们在按接口规则大量请求」这件事写在屏幕上 —— 没必要，
           * 而且对用户也毫无帮助（他只想知道「怎么办」）。
           *
           * 所以只说**用户能观察到的现象** + **该怎么办**：
           * 「暂时搜不到」+「等一会儿」+「别连点」。
           */
          title: '暂时搜不到结果',
          message:
            `《${songName}》没搜到结果。这通常是切歌切得太频繁导致的，` +
            '过一两分钟再试就好；期间尽量别连续切歌。',
          type: 'warning',
          duration: 0,
        });
      } else {
        ElMessage.error(`《${songName}》${this.uiStore.errMsg(err)}`);
      }
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

      /**
       * ★ 用 `withNet` 包住这次解析 —— 期间禁用控制栏里会发请求的控件
       *
       * 解析是**切歌/换清晰度必经的一次网络往返**（除非命中缓存）。
       * 包住它，用户在这段等待里点不动「上一首 / 下一首」，避免请求叠加。
       */
      const res = await this.uiStore.withNet(() =>
        electronApi.resolveVideoUrl(
          bvid,
          keyword,
          opts.skipCache ?? false,
          opts.noDash || this._dashDisabled,
          // 本次会话里手动选过的优先；没选过就交给主进程用设置里的默认值
          opts.qn ?? this.selectedQn ?? undefined,
          opts.audioId ?? this.selectedAudioId ?? undefined,
        ),
      );
      if (token !== this._videoToken) return; // 已有更新的请求，丢弃本次结果

      /**
       * 主进程解析失败时**不抛异常**，而是回 `{ videoUrl: null, error }`。
       * 原来这里完全不看 `error`：既没有提示，`applyVideoSource()` 又因为
       * videoUrl 为空什么都不做（旧视频接着播），可 currentBvid / 标题 / 清晰度
       * 已经被换成这个失败视频的空值，还会把它记成「上次播的视频」，
       * 下次续播继续踩同一个坑。所以失败必须在这里拦住。
       */
      if (res.error && !res.videoUrl && !res.dash) {
        // AUTH_FAILED 是主进程约定的「登录失效」错误码，给一句能照做的提示
        if (res.error === 'AUTH_FAILED') {
          throw new Error('B 站登录已失效，请重新登录后再试');
        }
        throw new Error(res.error);
      }
      this.queueStore.currentBvid = bvid;
      // dash 双轨（1080P+，需要 MSE 合成）与 durl（720P 混流）二选一
      this.dashSource = res.dash ?? null;
      this.videoUrl = res.videoUrl ?? '';
      this.applyVideoSource();
      const idx = this.queueStore.videoList.findIndex((item) => item.bvid === bvid);
      // 找不到就置 -1：selectedBvid 是历史选择，可能不在本次搜索结果里。
      // 置 -1 后列表不会把别的条目误标成「正在播放」。
      this.queueStore.currentVideoIndex = idx;
      const video = this.queueStore.videoList[idx];
      // 标题/封面以主进程回传的为准（它解析的就是正在播的这个视频），
      // 列表项只作兜底：缓存里可能还留着旧版本写坏的、缺 title/pic 的条目。
      this.videoName = res.title || video?.title || '';
      this.videoPic =
        normalizeImageUrl(res.pic ?? null) ||
        normalizeImageUrl(video?.pic ?? null) ||
        '';

      /**
       * ★ 这条视频**正在播**，但列表里它的时长可能是空的 —— 补上
       *
       * 原因：B 站搜索接口**有些结果压根不带 `duration`**，缓存就存成 NULL，
       * 列表那一行显示空秒数。可这条视频明明已经在播了
       * （用户看到「正在播的视频没有时长」就是这里缺的）。
       *
       * 两个来源，按可靠度取：
       *  1. 主进程解析时回传的 `res.duration`（view 响应里的权威值）；
       *  2. 兜底用 `<video>` 元素自己的 `duration`
       *     （分片 MP4 的 mvhd 常是 0，所以 0 / NaN / Infinity 都要过滤掉）。
       *
       * 补完**顺手回写库** —— 不然下次重开还是空的，每次都要重新补一遍。
       *
       * ## ⚠️ 判据不能是 `video && !video.duration`
       *
       * `video` 是 `findIndex` 的结果，而这段代码上面的注释自己就写着
       * 「`selectedBvid` 是历史选择，**可能不在本次搜索结果里** → 置 -1」。
       * 那种情况下 `video` 是 `undefined`，原来的写法会把整段直接跳过：
       * 界面不补、库里也永远是 NULL —— 而 `res.duration` 其实**已经在手上**，
       * 正是这个功能要处理的「搜索没给时长」的那类视频，等于白拿到了。
       *
       * 所以判据改成「**时长确实还缺**」：列表项不存在时也照样回写库；
       * 列表项存在且缺时才顺带就地赋值（响应式列表立刻显示出来）。
       */
      const needFill = !video || !video.duration;
      if (needFill) {
        const el = this.videoEl();
        const fromEl =
          el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
        const fromRes =
          typeof res.duration === 'number' &&
          Number.isFinite(res.duration) &&
          res.duration > 0
            ? res.duration
            : null;
        const filled = fromRes ?? fromEl;
        if (filled) {
          const sec = Math.round(filled);
          /** 列表里有这一条时**就地改**：`videoList` 是响应式的，立刻显示出来 */
          if (video) video.duration = sec;

          /**
           * 回写库：只更新这一条的时长，不动顺序、不动其它字段
           *
           * 失败不影响播放（只是下次还要再补一次），所以静默。
           */
          if (this.queueStore.songName) {
            void electronApi.fillVideoDuration(this.queueStore.songName, bvid, sec).catch(() => {
              /* 补时长失败不影响播放 */
            });
          }
        }
      }
      // 清晰度 / 音质只认 playurl 响应自己报的档位（不是请求参数里的 qn）
      this.videoQuality = res.quality ?? '';
      this.videoQualityDesc = res.qualityDesc ?? '';
      this.audioQuality = res.audioQuality ?? '';
      this.audioQualityDesc = res.audioQualityDesc ?? '';
      // 这个视频此刻可选的档位（切换菜单用）
      this.qualityOptions = res.options ?? null;

      /**
       * 这里**不再**调 `recordCurrentVideo`。
       *
       * 原来它把「这首歌选了哪个视频」写进歌单的 `videoCache`。那个字段已经删掉，
       * 而它要记的东西现在由主进程负责：`api:resolveVideo` 会写
       * `song_meta.selected_bvid`（本次改造放宽了它的写回条件，缓存命中也写）。
       * 渲染层再写一遍就是同一件事做两次，而且两处判据不一致时必然漂移。
       */
    } catch (err) {
      if (token !== this._videoToken) return;

      /**
       * 解析失败时**必须把上一首的视频信息清掉**。
       *
       * 前面那几行是「解析成功才赋值」，失败时如果不清，控制栏会继续显示
       * 上一首的视频标题 / 封面 / 清晰度 —— 用户切歌后看到的就是
       * 「歌名换了，可标题封面还是上一条」，看起来像「信息不切换」。
       * 清掉之后模板会退回显示歌名（`videoName || songName`），一眼能看出是解析失败了。
       */
      this.videoName = '';
      this.videoPic = '';
      this.videoQuality = '';
      this.videoQualityDesc = '';
      this.audioQuality = '';
      this.audioQualityDesc = '';
      this.qualityOptions = null;
      this.videoQualityPixels = '';
      ElMessage.error(this.uiStore.errMsg(err));
    }
  },




  /**
   * 手动切换清晰度 / 音质
   *
   * 选择只作用于**当前这一首**（`selectedQn` / `selectedAudioId`，换歌时在
   * `changeSong` 里清掉），不改设置里的默认值 —— 默认值在设置界面里改。
   * 重新解析会换掉流地址，所以先把播放进度记下来。
   *
   * ## ★ **不传 `skipCache`**（这里改过一次）
   *
   * 原来传的是 `skipCache: true`（「我改了清晰度，快重新取」）。但那是**多余**的：
   * B站给的一条 dash 流里**本来就带全部候选档位**，我们库里存的
   * `playurl_result` 是**整个 playurl 响应**。所以换清晰度只需要
   * `extractDashStreams(缓存的 playurl, 新qn, 新audioId)` —— 从同一份响应里
   * 按新档位重新挑一条流，**根本不用联网**。
   *
   * 主进程那边（`api:resolveVideo`）的判断链已经覆盖了所有该联网的情况：
   *
   * ```
   * 地址有效 且 缓存里有目标档位 → 用缓存（不联网）      ← 换清晰度走这条
   * 地址**已过期**              → 自动重新解析（联网）  ← 日志会打「缓存地址已过期」
   * 缓存里没有那个档位          → 自动重新解析（联网）  ← needDashUpgrade
   * 登录态变了（解锁更高档）      → 自动重新解析（联网）  ← loginChanged
   * ```
   *
   * 也就是说：**该联网的时候它自己会联**。`skipCache` 只是把「地址明明还没过期」
   * 这条快路径也一起废掉，白打一次请求 —— 而每一次多余的请求都在推高被 412 的概率。
   */
  async switchQuality(kind: 'video' | 'audio', id: number): Promise<void> {
    if (kind === 'video') this.selectedQn = id;
    else this.selectedAudioId = id;

    const bvid = this.queueStore.currentBvid;
    if (!bvid) return;

    /**
     * ★ 冷却 3 秒：刚改完清晰度/音质，两个下拉先禁用一会儿
     *
     * 放在**解析之前**（不是之后）：这样「解析期间 + 解析完成后 3 秒」
     * 连起来是禁用的，中间没有可连点的空窗。
     */
    this.uiStore.startQualityCooldown();
    const resumeAt = this.currentTime;
    if (resumeAt > 1) {
      this.seekAfterLoad = resumeAt;
      this.seekAfterLoadFor = this.queueStore.songName;
    }
    /** 不传 skipCache —— 见上面那段说明（该联网时主进程自己会联） */
    await this.changeVideo(bvid, this.queueStore.videoListKeyword || this.queueStore.songName);
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


    /**
     * 换了源就重置停滞看门狗的计时
     *
     * 必须在这里做：`currentSrc` 一设上就非空，而 `_lastProgressAt` 若还停在上一首
     * 最后一次推进的时间（可能很久以前），新源起播超过 12 秒就会被误判成「停滞」，
     * 弹提示并把**正在加载**的那个请求用 `changeVideo(skipCache)` 顶掉；
     * 重解析也慢的话再过 12 秒就变成「拉不动，已跳过」。
     */
    this._lastProgressAt = Date.now();
    this._stallSince = 0;
    // 换了源就重新给这条流机会（上一轮可能已经判定放弃过）
    this._stallGivenUp = false;


    /**
     * 换源时**不要立刻**亮缓冲提示。
     *
     * 搜索 / 播放地址都有缓存时，切歌常常 200~400ms 就出画了，
     * 提示亮一下再灭反而像闪屏（用户说的「切歌时的加载条」）。
     * 所以延迟 500ms：真慢（重新联网解析、MSE 拉流慢）还是会显示，反馈不丢。
     */
    this.bufferPercent = 0;
    this.bufferSeconds = 0;
    this.stopBufferTicker();
    this.buffering = false;
    this.scheduleBufferOverlay();

    const dash = this.dashSource;
    if (dash && DashSession.isSupported(dash)) {
      const session = new DashSession(el);

      /**
       * `markRaw` 不能省：`data()` 里的对象会被 Vue 变成响应式，读 `this._dashSession`
       * 拿到的是 **reactive 代理**，而闭包里的 `session` 是原始对象 —— 两者 `!==` 恒为真，
       * 下面那句「期间已经换过源就忽略」会把**每一次**失败都当成「已经换过源」，
       * `fallbackToDurl()` 成了死代码。表现是 dash 起播失败（sourceopen 超时、配额耗尽，
       * 这些都不触发 <video> 的 error）时黑屏挂着，最后整首歌被跳过。
       */
      this._dashSession = markRaw(session);
      session
        .start(dash)
        .catch((err) => {
          // 期间已经换过源（切歌 / 换视频）就忽略这次失败
          if (this._dashSession !== session) return;
          console.warn('[video] dash 播放失败，退回 durl:', err);
          this.fallbackToDurl();
        });

      /**
       * 立刻把 `play()` 叫起来（别等 `loadeddata`）
       *
       * 踩过：起播的 `play()` 原来只在 `onVideoLoaded` 里调用，而 dash 会话卡住时
       * `loadeddata` 永远不来 —— 元素一直 `paused === true`，停滞看门狗的第一道判断
       * 就会把它当成「用户暂停了」，于是「时长有了、画面一个字节都没有」永久卡住。
       * 这里叫起来之后就算数据不来，`paused` 也是 false，12 秒后兜底照常生效。
       */
      if (!this.paused) void el.play().catch(() => {});
      return;
    }


    /**
     * 环境不支持这条 dash 编码：**必须真的退回 durl**
     *
     * 踩过：这里原来只打一行「改用 durl」的日志，什么都没做；而此时旧会话已经 stop、
     * blob 地址也 revoke 过了，走 dash 时主进程回的 `videoUrl` 本来就是 null ——
     * 结果新源根本没设上，画面停在上一首，界面却已经是新歌名，下一首还会重复。
     */
    if (dash && !DashSession.isSupported(dash)) {
      console.warn('[video] 当前环境不支持该 dash 编码，退回 durl');
      this._dashDisabled = true;
      this.fallbackToDurl();
      return;
    }
    if (this.videoUrl) {
      el.src = this.videoUrl;
      // 同上：不等 loadeddata，先把播放意图落到元素上（否则「没数据的源」会让
      // 元素一直 paused，停滞兜底进不去）
      if (!this.paused) void el.play().catch(() => {});
    }
  },




  /**
   * 延迟显示换源缓冲提示
   *
   * 500ms 内已经能播（`readyState >= 3`）就完全不显示；
   * 否则亮出来，用户知道是在拉流而不是卡死。
   */
  scheduleBufferOverlay(): void {
    this.clearBufferOverlayTimer();
    this._bufferOverlayTimer = setTimeout(() => {
      this._bufferOverlayTimer = null;
      const el = this.videoEl();
      if (!el || el.readyState >= 3) return;

      /**
       * 已经缓冲出足够数据（≥1 秒）也别亮提示。
       *
       * 实测：预热过的切歌里有 200ms 左右「数据其实早就够了、只是解码器还没出画」的空窗，
       * 这时亮一个 99% 的圈纯粹是干扰 —— 够播了就该直接出画。
       */
      if (this.bufferedAhead() >= 1) return;
      this.buffering = true;
      this.syncBufferState();
      this.startBufferTicker();
    }, 500);
  },




  clearBufferOverlayTimer(): void {
    if (this._bufferOverlayTimer) {
      clearTimeout(this._bufferOverlayTimer);
      this._bufferOverlayTimer = null;
    }
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
  rememberSeekPoint(): void {
    // 位置优先取元素上的（切源瞬间 this.currentTime 可能还是上一帧的旧值）
    const v = this.videoEl();
    const at = v && Number.isFinite(v.currentTime) ? v.currentTime : this.currentTime;
    if (at > 1) {
      this.seekAfterLoad = at;
      // 标明是给这首歌设的：中途切歌时 onVideoLoaded 会把不匹配的定位丢掉
      this.seekAfterLoadFor = this.queueStore.songName;
    }
  },




  fallbackToDurl(): void {
    this.stopDashSession();
    this.dashSource = null;
    this._dashFailures += 1;
    if (this._dashFailures >= 2) {
      this._dashDisabled = true;
      console.warn('[video] dash 连续失败，本会话改用 durl');
    }
    const bvid = this.queueStore.currentBvid;
    if (!bvid) return;
    // 换 durl 会重新加载视频，把当前进度记下来接着播
    this.rememberSeekPoint();
    void this.changeVideo(bvid, this.queueStore.videoListKeyword || this.queueStore.songName, {
      skipCache: true,
      noDash: true,
    });
  },




  /**
   * 当前歌曲对应的视频封面（B 站缩略图）
   *
   * 优先用正在播放的那个视频的缩略图，其次用候选列表里那一条的缩略图。
   *
   * 这里删掉了最后那级「歌单 videoCache 里记住的封面」兜底：那个字段已经不存在，
   * 而它记录的封面本来就来自 `videoList` 的同一项（`changeVideo` 写进去的就是
   * `video?.pic`），所以列表里没有的时候它也不会有新东西 —— 属于查不到还会
   * 多一次 IPC 的兜底，直接去掉。
   */
  currentVideoCover(): string | null {
    // 正在播的那个视频的缩略图：主进程随播放地址一起回传，最可靠
    const own = normalizeImageUrl(this.videoPic || null);
    if (own) return own;
    const v =
      this.queueStore.videoList[this.queueStore.currentVideoIndex] ??
      this.queueStore.videoList.find((item) => item.bvid && item.title === this.videoName);
    const pic = normalizeImageUrl(v?.pic ?? null);
    if (pic) return pic;
    return null;
  },




  /** 当前歌曲的封面：优先平台专辑图，退回视频缩略图 */
  currentCover(): string | null {
    const song = this.queueStore.getSong(this.queueStore.currentIndex);
    const own = normalizeImageUrl(song?.cover ?? null);
    if (own) return own;
    return this.currentVideoCover();
  },



  /**
   * 预热「上一首 / 下一首」
   *
   * 目的：**手动切歌也不要停滞感**。切歌那次卡顿来自两段：
   *   1. 搜索 + 播放地址解析（缓存未命中时 1~3 秒网络往返）
   *   2. MSE 起播（要拉到第一个分片才能出画）
   * 所以两个方向都提前做：
   *   - 歌一开始播就把两个方向的**接口结果**备好（很便宜，几 KB）；
   *   - 接口就绪后把它们的**开头几秒真的拉起来**（隐藏的 <video>，静音），
   *     这样切过去时同源媒体缓存里已有数据，出画几乎没有等待。
   *
   * 唯一要克制的是流量：预热的媒体流只拉 2.5 秒就停，而且**自己这边缓冲充足才做**
   * （`bufferSeconds >= 5`），网络紧张时优先保当前播放。
   */
  maybeWarm(): void {
    const v = this.videoEl();
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    if (v.currentTime > 2) void this.warmApi('next');
    // 再往后一点才做上一首，避免刚开播就两个请求一起打出去
    if (v.currentTime > 6) void this.warmApi('prev');
    // 接口备好了就把开头拉起来（近片尾时两个方向都要保证是热的）
    const nearEnd = d > 0 && d - v.currentTime <= PREFETCH_AHEAD_S;
    if (this.bufferSeconds >= 5 || nearEnd) {
      if (this._warm.next) this.warmMedia('next');
      if (this._warm.prev) this.warmMedia('prev');
    }
  },




  /** 预热用「下一首 / 上一首」下标：规则与 next()/prev() 完全一致 */
  indexForDir(dir: 'next' | 'prev'): number {
    const len = this.queueStore.songs.length;
    if (len === 0) return -1;
    if (this.currentMode === this.queueStore.MODE.random) {
      if (this.queueStore.randomList.length === 0) this.queueStore.resetRandomList();
      const pos = this.queueStore.randomList.indexOf(this.queueStore.currentIndex);
      if (pos === -1) return -1;
      return dir === 'next'
        ? this.queueStore.randomList[(pos + 1) % this.queueStore.randomList.length]
        : this.queueStore.randomList[(pos - 1 + this.queueStore.randomList.length) % this.queueStore.randomList.length];
    }
    return dir === 'next' ? (this.queueStore.currentIndex + 1) % len : (this.queueStore.currentIndex - 1 + len) % len;
  },




  /** 搜索 + 解析某个方向的下一首（结果放进槽位，供切歌时直接命中缓存） */
  async warmApi(dir: 'next' | 'prev'): Promise<void> {
    if (this._warming[dir]) return;
    // 已经彻底失败过：不再重试，等换歌 / 换歌单时由 clearWarm 重置
    if (this._warmFailed[dir]) return;

    /**
     * ★ **有别的请求在飞时不要凑热闹**（预热自己让路）
     *
     * 预热是「后台悄悄准备下一首」，用户并不着急 —— 而它同样要打两个请求
     * （搜索 + 解析）。如果主流程正在搜索/解析（`netBusy`），再叠上来
     * 就是在同一时刻往上堆请求，正是 B站 412 的成因。
     *
     * 所以这里**让路**：等主流程忙完，下一跳心跳（每秒一次）再试。
     *
     * ⚠️ 注意预热**不参与 `netBusy`**（不把它算进 `_netBusyCount`）：
     * 它是后台行为，用户什么都没点，不该因此看到按钮变灰。
     * 下面的 `electronApi` 调用因此**不套 `withNet`** —— 它有自己这套
     * `_warming` / `_warmTries` / `_warmRetryAt` 节流。
     */
    if (this.uiStore.netBusy) return;

    /**
     * 失败后的重试节流：心跳是每秒一次，光看 `_warmTries` 做不到「间隔 3 秒」——
     * 三次会在 3 秒内打完。所以还要看上次失败的时间戳。
     */
    if (this._warmTries[dir] > 0 && Date.now() - this._warmRetryAt[dir] < WARM_RETRY_DELAY_MS) {
      return;
    }
    const idx = this.indexForDir(dir);
    if (idx < 0) return;
    const songName = this.queueStore.getSongName(idx);
    const parts = this.queueStore.getSongParts(idx);
    if (!songName || !parts || songName === this.queueStore.songName) return;
    if (this._warm[dir]?.song === songName) return; // 已经是热的
    this._warming[dir] = true;
    try {

      /**
       * ⚠️ 预热**不套 `withNet`**（不参与 `netBusy`，理由见函数开头那段）——
       * 它是后台行为，用户什么都没点，不该因此看到按钮变灰。
       * 防叠加靠入口处的「有请求在飞就让路」+ 它自己的 `_warming` 标记。
       */
      const res = await electronApi.searchSong(parts.song, parts.singer);
      const videos = (res.data as { result?: BiliVideo[] } | null)?.result ?? [];
      const list = videos;

      /**
       * 与 `changeSong` 的挑选规则**逐字一致**，保证预热的就是待会儿真正要播的那个。
       *
       * 必须也问 `getSelectedBvid`：`changeSong` 现在优先用它，
       * 而搜索返回体里那份 `selectedBvid` 只是兜底。两边规则不一样的话，
       * 预热好的地址到了切歌时会被换掉（白预热，用户还是要等一次解析）。
       */
      const remembered = await electronApi.getSelectedBvid(songName);
      const bvid =
        remembered ||
        (res.data as { selectedBvid?: string } | null)?.selectedBvid ||
        list[0]?.bvid;
      if (!bvid) {

        /**
         * 搜不到视频 —— **必须记账，否则会每秒重试**
         *
         * 踩过：这里原来直接 `return`，而 `_warm[dir]` 是空的，所以
         * `_warm[dir]?.song === songName` 那个「已经是热的」判断永远不成立，
         * 而 `finally` 又把 `_warming` 复位了 —— 心跳每秒进来一次，
         * **每秒发一次真网络请求，永不停止**。
         *
         * 症状：控制台同一个关键词刷几十行「搜索结果为空」，
         * 界面变卡（尤其是「歌名-歌手」很长的缓存键，B 站必然搜不到）。
         *
         * 现在按「重试 3 次、间隔 3 秒」处理：没到上限就等下一轮心跳
         * （心跳本身是 1 秒一次，所以额外加一个 3 秒的节流由 `_warmTries` 的时间戳控制）。
         */
        this._warmTries[dir] += 1;
        // 记下这次失败的时刻：下一轮心跳要靠它判断「够 3 秒了没」
        this._warmRetryAt[dir] = Date.now();
        if (this._warmTries[dir] >= WARM_MAX_TRIES) {
          this._warmFailed[dir] = true;
          console.warn(
            `[prefetch] ${dir === 'next' ? '下一首' : '上一首'}《${songName}》预热失败 ` +
              `${WARM_MAX_TRIES} 次（搜不到视频），不再重试。` +
              (this.sessionStore.isLoggedIn ? '' : '（未登录，登录后可能就能找到了）'),
          );

          /**
           * 提示用户 —— 但**只在未登录时**弹，因为那才是他能采取行动的情况。
           *
           * 已登录还搜不到，多半是这首歌本身在 B 站没有对应视频（歌名太长、
           * 多歌手用「、」连起来那种），提示「请登录」是误导。
           *
           * ⚠️ 文案**不描述 B 站的返回机制**（别说「未登录时只返回部分结果」）——
           * 那是内部行为，写进用户可见的提示里没必要。
           */
          if (!this.sessionStore.isLoggedIn) {
            ElNotification({
              title: '有歌曲预热失败',
              message: `《${songName}》搜不到视频。登录后再试一次，通常就能找到了。`,
              type: 'warning',
              duration: 6000,
            });
          }
        } else {
          console.warn(
            `[prefetch] ${dir === 'next' ? '下一首' : '上一首'}《${songName}》搜不到视频，` +
              `第 ${this._warmTries[dir]}/${WARM_MAX_TRIES} 次（${WARM_RETRY_DELAY_MS / 1000}s 后再试）`,
          );
        }
        return;
      }
      const url = await electronApi.resolveVideoUrl(
        bvid,
        songName,
        false,
        this._dashDisabled,
      );
      this._warm[dir] = {
        song: songName,
        bvid,
        videoUrl: url.videoUrl ?? null,
        dash: url.dash ?? null,
      };
      // 换了一首歌的预热结果 → 「热过了」的标记要跟着重置，否则它永远不会被真正拉起来
      this._warmed[dir] = false;
      console.log(`[prefetch] 已备好${dir === 'next' ? '下一首' : '上一首'}：${songName}`);
    } catch (err) {
      // 预热失败完全不影响正常切歌（该联网还是联网），静默记一笔
      console.warn(`[prefetch] 预热${dir}失败（忽略）:`, err);
    } finally {
      this._warming[dir] = false;
    }
  },




  /**
   * 把某个方向的开头几秒真的拉起来
   *
   * 用隐藏的静音 `<video>` + 同一个 dash 会话实现：这样**连接（DNS/TLS/HTTP2）是热的**，
   * 能进 HTTP 缓存的分片也已经在本地，切过去时不用从零开始拉。
   *
   * 刻意**不调用 `play()`**：
   *  - 播放会占用系统媒体控件（SMTC 面板可能被这个隐藏元素顶掉）；
   *  - MSE 的分片是 JS 自己灌进去的，`start()` 本身就会拉数据，不需要真的播。
   * 拉 2 秒就停，元素留着复用。
   */
  warmMedia(dir: 'next' | 'prev'): void {
    const info = this._warm[dir];
    if (!info || this._warmed[dir] || this._warmSession[dir] || this._warmTimer[dir]) return;
    const nearEnd = this.duration > 0 && this.duration - this.currentTime <= PREFETCH_AHEAD_S;
    // 自己这边都快不够播了就先不抢带宽（近片尾时例外：马上要切了）
    if (this.bufferSeconds < 5 && !nearEnd) return;
    const el = this.warmElement(dir);
    if (!el) return;
    try {
      if (info.dash && DashSession.isSupported(info.dash)) {
        const session = new DashSession(el);
        this._warmSession[dir] = session;
        session.start(info.dash).catch(() => this.stopWarmMedia(dir));
      } else if (info.videoUrl) {
        el.src = info.videoUrl;
      } else {
        return;
      }
    } catch (err) {
      console.warn(`[prefetch] 预热媒体${dir}失败（忽略）:`, err);
      this.stopWarmMedia(dir);
      return;
    }
    // 只要开头那一小段，别把整条片子下下来；拉过就标记「这个方向热了」，不再重复拉
    this._warmed[dir] = true;
    this._warmTimer[dir] = setTimeout(() => this.stopWarmMedia(dir), 2000);
  },




  /** 取（或创建）预热用的隐藏元素：移出可视区、静音，绝不参与界面 */
  warmElement(dir: 'next' | 'prev'): VideoElement | null {
    if (this._warmEl[dir]) return this._warmEl[dir];
    const el = document.createElement('video');
    el.muted = true;
    el.volume = 0;
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(el);
    this._warmEl[dir] = el as unknown as VideoElement;
    return this._warmEl[dir];
  },




  /** 停掉某个方向的预热播放（元素留着下次复用） */
  stopWarmMedia(dir: 'next' | 'prev'): void {
    if (this._warmTimer[dir]) {
      clearTimeout(this._warmTimer[dir]);
      this._warmTimer[dir] = null;
    }
    const session = this._warmSession[dir];
    if (session) {
      this._warmSession[dir] = null;
      try {
        session.stop();
      } catch {
        /* 忽略 */
      }
    }
    const el = this._warmEl[dir];
    if (el) {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {
        /* 忽略 */
      }
    }
  },




  /** 丢掉某个方向的预热结果（切进那首歌了 / 歌单变了） */
  clearWarm(dir: 'next' | 'prev'): void {
    this.stopWarmMedia(dir);
    this._warm[dir] = null;
    // 结果作废 → 「热过了」的标记也一起清掉，下一首才有机会再预热
    this._warmed[dir] = false;

    /**
     * 失败计数与「已彻底失败」标记**一起清掉** —— 换了歌就该重新给机会。
     *
     * 不清的话：某一首歌搜不到导致该方向被永久封禁，
     * 后面所有歌的预热都不再发生（用户会感觉「切歌越来越慢」却找不到原因）。
     */
    this._warmTries[dir] = 0;
    this._warmFailed[dir] = false;
    this._warmRetryAt[dir] = 0;
  },




  /** 两个方向全部作废（换歌单 / 清空播放） */
  clearAllWarm(): void {
    this.clearWarm('next');
    this.clearWarm('prev');
  },




  /** 已经切进预热过的那首歌：对应槽位作废 */
  dropWarmIfCurrent(): void {
    if (this._warm.next?.song === this.queueStore.songName) this.clearWarm('next');
    if (this._warm.prev?.song === this.queueStore.songName) this.clearWarm('prev');
  },



  /**
   * 缓冲提示
   *
   * 显示时机只由 `<video>` 自己的信号决定（waiting / stalled / seeking / 换源），
   * 不用 `readyState` 主动显示 —— 否则正常播放时也会闪一下。
   * 隐藏则由「够播了」来判定（见 syncBufferState）。
   */
  onVideoBuffering(): void {
    this.buffering = true;
    this.syncBufferState();
    this.startBufferTicker();

    /**
     * 真卡了就先松开预热的流。
     *
     * 预热是「为了更顺」，绝不能反过来把当前播放挤卡 ——
     * 一旦出现 waiting/stalled，立刻停掉两个方向的预热下载。
     */
    this.stopWarmMedia('next');
    this.stopWarmMedia('prev');
  },




  onVideoPlaying(): void {
    this.buffering = false;
    this.bufferPercent = 100;
    this.stopBufferTicker();
    // 已经出画：撤掉还没到点的换源提示
    this.clearBufferOverlayTimer();
  },




  /** 已经缓冲到第几秒（取**包含当前播放点**的那一段的末尾） */
  lastBufferedEnd(): number {
    const el = this.videoEl();
    if (!el || !el.buffered.length) return 0;
    const t = el.currentTime;

    /**
     * 为什么要挑「包含播放点」的那一段
     *
     * 往前拖到未缓冲区域后，`buffered` 会出现第二段区间（比如 [0,10] 和 [60,90]）。
     * 直接取最后一段的末尾（90）会把「已缓冲 80 秒」这种虚高的数字报给界面，
     * 于是「够播了」可能提前成立、缓冲提示被撤掉；预热那边「自己缓冲是否充足」的
     * 带宽闸门也会被骗着在真缺数据时去抢带宽。
     */
    for (let i = 0; i < el.buffered.length; i += 1) {
      if (t >= el.buffered.start(i) && t <= el.buffered.end(i)) return el.buffered.end(i);
    }

    /**
     * 播放点不在任何缓冲段里（刚开始加载 / 正在拖动）：沿用「最后一段末尾」的老行为。
     * 这里刻意保守 —— 换成返回 0 会让起播瞬间的 `bufferSeconds` 变成 0，
     * 「够播了」不成立，缓冲提示反而不该亮的时候亮着。
     */
    return el.buffered.end(el.buffered.length - 1);
  },




  /**
   * 片尾看门狗
   *
   * dash（MSE）偶尔会「缓冲已经到底、画面也播到最后一秒，但 `ended` 就是不触发」，
   * 于是自动下一首永远不会发生，界面上只留一个不动的缓冲圈 —— 用户看到的就是
   * 「播到还剩一秒卡住，弹个 98% 不动」。
   *
   * 判定条件卡得很死，避免把「尾巴还在下载」误判成播完：
   *  - 已经进入最后 2 秒，且**缓冲末尾真的到了片尾**（尾巴没下完就不会满足）
   *  - 没有暂停 / 没有在 seek（否则不动是正常的）
   *  - 位置连续 3 秒没有前进
   * 命中就按「播完了」处理（单曲循环重播，其余模式下一首）。
   */
  checkEndOfStream(): void {
    const v = this.videoEl();
    if (!v || this._endStallHandled) return;
    const d = v.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    if (v.paused || v.seeking) return;
    if (v.currentTime < d - 2) return;

    /**
     * 缓冲末尾的判定要留足余量。
     *
     * 实测的卡死现场：`155.1 / 156.0`、`readyState = 2`（有当前帧、没有后续数据），
     * 缓冲末尾就停在 155.1 —— 比总时长差 0.9 秒。原来要求 `>= duration - 0.5`，
     * 正好差一点点不满足，于是**看着它卡在那里什么都不做**（这就是用户报的那个 bug）。
     * 放宽到 2.5 秒：片尾这几秒本来就短，差这么多只可能是「拿不到剩下的了」。
     */
    if (this.lastBufferedEnd() < d - 2.5) return;

    /**
     * 等多久算真卡住：`readyState >= 3` 说明还有后手数据，等 3 秒；
     * `readyState <= 2`（等着数据但没来）多给一点时间，避免尾巴下载慢时误判成播完。
     */
    const wait = v.readyState >= 3 ? 3000 : 5000;
    if (Date.now() - this._lastProgressAt < wait) return;
    this._endStallHandled = true;
    console.warn('[video] 片尾卡住（缓冲到底但没触发 ended），按播完处理');
    this.videoEnded();
  },




  startEndWatch(): void {
    if (this._endWatchTimer) return;
    this._endWatchTimer = setInterval(() => {
      this.checkEndOfStream();
      // 片尾看门狗之外，再管「中途/刚开播就不动了」的情况
      this.checkPlaybackStall();
      this.maybeWarm();
    }, 1000);
  },




  /**
   * 播放停滞看门狗（不只是片尾）
   *
   * 用户反馈：偶尔一打开就显示「99% 缓冲」卡住，点一下下一首就好了。
   * 那种情况是「有数据但不继续来」：`syncBufferState` 的隐藏条件是
   * `readyState >= 3` 且余量够 1 秒，数据不来就永远不满足；而百分比被夹在 99
   * （分母是「播放点 + 余量」，没下完就不会到 100），于是圈一直挂着。
   *
   * 判据（1 秒心跳里看，都要满足）：
   *  - 没暂停 / 没拖动 / 已经拿到时长（真的在放一条片子）
   *  - 不在最后 2 秒（片尾另有 `checkEndOfStream`）
   *  - 播放位置连续 `STALL_MS` 没前进（`_lastProgressAt` 由 timeupdate 维护）
   * 命中后按「先重解析、再跳下一首」两级处理，和 `videoError` 的思路一致。
   */
  checkPlaybackStall(): void {
    const v = this.videoEl();
    // 已经判定这条流救不回来（单曲歌单 + 反复停滞）：别再周期性告警
    if (this._stallGivenUp) return;

    /**
     * `paused` 不能一概当成「用户暂停了」
     *
     * 踩过：起播的 `play()` 原来只在 `onVideoLoaded`（`@loadeddata`）里调用，
     * 而 dash（MSE）会话卡住时 `loadeddata` **永远不来** —— 元素一直 `paused === true`，
     * 这里第一道判断就把自己排除掉了，于是「时长有了、画面一个字节都没有」会**永久卡住**，
     * 连重解析兜底都进不去（用户报的就是这个）。
     * 判据：`readyState === 0` 且位置还是 0 = 一个字节都没到，算停滞，照样走兜底。
     */
    const neverStarted = v ? v.readyState === 0 && v.currentTime === 0 : false;
    if (!v || v.seeking || (v.paused && !neverStarted)) {
      // 暂停/拖动时不动是正常的：计时和「已恢复几次」都清掉，
      // 否则用户暂停过一次，本曲第一次真停滞会直接走「已跳过」而省掉重解析
      this._stallSince = 0;
      this._stallRecoveries = 0;
      return;
    }

    /**
     * 还没给过源就不管：起播前本来就该等。
     * 判据用 `currentSrc`（MSE 下是 blob: 地址，普通播放是直链），它空着说明连源都没设。
     */
    if (!v.currentSrc) {
      this._stallSince = 0;
      return;
    }
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;

    /**
     * **`duration` 为 0 正是用户报的那个场景**，不能提前 return。
     *
     * 现场是：时长那里显示 `0:00`、缓冲圈停在 99%。原因是 MSE 已经有分片进来了
     * （所以 `buffered.end()` 有值、百分比能算到 99），但整条的 duration 一直没确定、
     * `readyState` 也上不去 —— 于是 `syncBufferState` 的隐藏条件永远不满足，圈就挂着。
     * 原来这里写了「没拿到时长就直接返回」，等于把这个场景排除在保护之外。
     */
    const noDuration = d === 0;
    if (!noDuration && v.currentTime >= d - 2) {
      // 片尾交给 checkEndOfStream，别两边同时动手
      this._stallSince = 0;
      return;
    }
    // 2 秒内有前进就算正常（timeupdate 约 250ms 一次，留足余量）
    if (Date.now() - this._lastProgressAt < 2000) {
      this._stallSince = 0;
      this._stallRecoveries = 0;
      return;
    }
    if (!this._stallSince) {
      this._stallSince = Date.now();
      return;
    }
    if (Date.now() - this._stallSince < STALL_MS) return;

    // 记一次恢复尝试，并把计时重置为「再看一个 STALL_MS」
    this._stallSince = Date.now();
    this._stallRecoveries += 1;
    console.warn(
      `[video] 播放停滞 ${STALL_MS}ms（t=${v.currentTime.toFixed(1)} duration=${d} readyState=${v.readyState} 第 ${this._stallRecoveries} 次恢复，源 ${this._stallUrlIndex + 1}，已降 ${this._stallQualityDrops} 档）`,
    );

    this.recoverFromStall();
  },




  /**
   * ★ 卡顿恢复链（分级推进，每命中一次 `STALL_MS` 走一步）
   *
   * ```
   * ① 换同一清晰度的**备用源**（backupUrl）        ← 无条件自动
   * ② 备用源试完还卡 → 降一档清晰度（回到 ①）      ← ★ 只看「自动降清晰度」开关
   * ③ 降了 3 档还卡 → 降 durl                      ← 无条件自动
   * ④ durl 还卡 → 暂停 + notify「检查网络连接」
   * ```
   *
   * ## 开关只影响第 ② 步
   *
   * 「换源」和「降 durl」不损失清晰度体验（还是同一档画面 / 只是换封装），
   * 所以**无条件做**；只有「降清晰度」是画面变糊，才让用户决定：
   *  - **开**：自动降 + `message` 告知「已自动降低清晰度为 XXX」
   *  - **关**：不降，`message` 提示「建议降到 XXX」让用户自己点
   *
   * ## 关掉自动降时**不一级级降**
   *
   * 用户明确要求：关的时候换完备用源还卡就**直接降 durl**（不是一级级降下来）。
   * 因为"不自动降"意味着用户想保住当前清晰度，那就别拿一串中间档位烦他。
   */
  recoverFromStall(): void {
    /** 换源要保留播放位置（换 src 会清零） */
    this.rememberSeekPoint();

    const dash = this.dashSource;

    /**
     * ① 还有没用过的备用源 → 换下一个
     *
     * `_stallUrlIndex` 记着「当前试到第几个」；换源时递增。
     */
    if (dash && this._stallUrlIndex + 1 < dash.videoUrls.length) {
      this._stallUrlIndex += 1;
      const nextUrl = dash.videoUrls[this._stallUrlIndex];
      ElMessage.warning(
        `网络不稳定，正在切换备用源（${this._stallUrlIndex + 1}/${dash.videoUrls.length}）`,
      );
      this.switchDashUrl(nextUrl);
      return;
    }


    /**
     * ② 备用源试完了
     *
     * - 自动降清晰度**开** → 降一档（最多 3 档）
     * - **关** → 跳过这一步，直接进 ③ 降 durl
     */
    if (dash && this.settingStore.setting['player.autoDowngradeOnStall']) {
      if (this._stallQualityDrops < MAX_QUALITY_DROPS) {
        const lower = this.nextLowerQuality();
        if (lower) {
          this._stallQualityDrops += 1;
          ElMessage.warning(`网络不稳定，已自动降低清晰度为 ${lower.label}`);
          void this.switchQuality('video', lower.id);
          return;
        }
      }
    }


    /**
     * ③ 降 durl（混流 720P）
     *
     * 只有 dash 才需要这一步（已经在 durl 上就没什么可降的了）。
     */
    if (dash) {

      /**
       * ⚠️ 提示文案不要出现「已切换到 720P 混流，可以切换到 720P 试试」这种废话
       * （用户明确吐槽过）。分两种情况：
       *  - 当前清晰度**不是** 720P → 告知降到了 720P，并建议他试试**下一级**
       *  - 当前**就是** 720P（甚至更低）→ 只说「已切换到混流」，不提清晰度
       */
      const curLabel = this.currentQualityLabel();
      const lower = this.nextLowerQuality();
      if (lower && lower.label !== curLabel) {
        ElMessage.warning(
          `网络不稳定，已切换到 720P，可以试试 ${lower.label}`,
        );
      } else {
        ElMessage.warning('网络不稳定，已切换到 720P');
      }
      this.fallbackToDurl();
      return;
    }


    /**
     * ④ durl 也卡 → 暂停 + 常驻提示（用户要「一直显示」，所以用 `$notify`）
     *
     * 不跳下一首：用户说过「那样下一首也会卡的」，跳了没意义。
     *
     * ## ⚠️ 常驻通知必须**只留一条**（踩过）
     *
     * 这个通知 `duration: 0`（不自动消失，要手动关）。而 `_stallGivenUp`
     * 会在**每次换源**时被复位（`applyVideoSource`）—— 于是用户手动切个清晰度
     * 或再 fallback 一次之后，8 秒又能弹一条**同样的**常驻通知，
     * 旧的那条还挂在屏幕右上角 → **通知叠加**。
     *
     * 所以这里自己记着「那条通知还开着没有」：还开着就**不再新弹**，
     * 由用户在关闭时（`onClose`）把标记清掉。这样「同时最多一条」是硬保证，
     * 不再依赖 `_stallGivenUp` 的复位时机。
     */
    if (!this._stallGivenUp) {
      this._stallGivenUp = true;
      this.videoEl()?.pause();
      this.paused = true;
      if (!this._stallNoticeOpen) {
        this._stallNoticeOpen = true;
        ElNotification({
          title: '播放已暂停',
          message: '网络连接不稳定，所有播放源都卡住了，请检查网络状况',
          type: 'warning',
          duration: 0,
          onClose: () => {
            this._stallNoticeOpen = false;
          },
        });
      }
      console.warn('[video] 所有源都卡顿，已暂停并提示用户检查网络');
    }
  },




  /**
   * 换到**同一个清晰度**的另一个源（不重新解析，只换 URL）
   *
   * 为什么值得做：卡顿往往是某个 CDN 节点的问题，B 站每条流都给了
   * `baseUrl` + 多个 `backupUrl`（不同 CDN）。换一个通常立刻就好，
   * 比降清晰度 / 重新解析都快。
   */
  switchDashUrl(videoUrl: string): void {
    const dash = this.dashSource;
    if (!dash) return;
    const el = this.videoEl();
    if (!el) return;

    /**
     * 只换视频轨的地址，音频轨保持不变 —— 卡顿通常是视频带宽吃紧
     * （音频只有几十 KB/s，很少成为瓶颈），换音频源收益小、风险大。
     */
    this.dashSource = { ...dash, videoUrl };
    this.applyVideoSource();
  },




  /** 当前清晰度的可读名（`1080P60` 这种） */
  currentQualityLabel(): string {
    const qn = this.currentVideoQn;
    if (qn == null) return '720P';
    return findQualityOption(VIDEO_QUALITY_OPTIONS, qn)?.label ?? String(qn);
  },




  /**
   * 比当前低一档的清晰度
   *
   * 按 `VIDEO_QUALITY_OPTIONS` 的顺序（从高到低）找当前档位的**下一个**。
   * 找不到（已经在最低档）返回 `null`。
   */
  nextLowerQuality(): { id: number; label: string } | null {
    const qn = this.currentVideoQn;
    if (qn == null) return null;
    const list = VIDEO_QUALITY_OPTIONS;
    const idx = list.findIndex((o) => o.id === qn);
    if (idx < 0) return null;
    const next = list[idx + 1];
    return next ? { id: next.id, label: next.label } : null;
  },




  /**
   * 刷新缓冲百分比
   *
   * 量的是「离能播还差多少」，而不是「整条视频下载了多少」——
   * 后者在限流之后会长时间停在很小的数字上，看着更像卡死。
   *
   * 关键：切歌/续播时播放点常常落在**已缓冲区间之外**（比如定位到 12.7 秒、
   * 但只下到 5 秒），这时进度应该按「下载到播放点」算：
   * 所以分子取「最后一段缓冲的末尾」，分母取「播放点 + 余量」。
   */

  /**
   * 播放点往后**连续可用**多少秒
   *
   * 播放点不在任何缓冲段里就返回 0 —— 这正是「时长有了、一个字节都没解码」那种卡住的判据。
   * 不能用 `lastBufferedEnd()` 代替：它取的是「包含播放点那段的末尾，否则最后一段的末尾」，
   * 当播放点在第一个缓冲段**之前**（MSE 刚 append、还没起播）时会给出一个很大的数，
   * 于是缓冲提示被误判成「早就够播了」而**不显示**（用户报的「加载条也不显示就卡在那里」）。
   */
  bufferedAhead(): number {
    const el = this.videoEl();
    if (!el || !el.buffered.length) return 0;
    const t = el.currentTime;
    for (let i = 0; i < el.buffered.length; i += 1) {
      if (t >= el.buffered.start(i) && t <= el.buffered.end(i)) {
        return Math.max(0, el.buffered.end(i) - t);
      }
    }
    return 0;
  },




  syncBufferState(): void {
    const el = this.videoEl();
    if (!el) return;
    const ahead = this.bufferedAhead();
    this.bufferSeconds = ahead;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    /** 从播放点往后连续可用到哪一秒（有空洞时就是播放点本身） */
    const end = el.currentTime + ahead;

    /**
     * 分母不能超过片子总长。
     *
     * 原来分母是 `max(播放点 + 3, 5)`，越接近片尾这个数越大，而缓冲末尾最多只能到
     * `duration`（播放器不可能缓冲到片子后面）—— 于是进度永远差一点点，
     * 表现就是「播到还剩一秒，弹个 98% 的圈不动」。夹到 duration 之后，
     * 片尾那几秒的百分比就是真实的「下载到哪了」。
     */
    const target = Math.max(el.currentTime + LEAD_S, START_BUFFER_S);
    const need = duration > 0 ? Math.min(duration, target) : target;
    const ratio = end <= 0 || need <= 0 ? 0 : Math.min(1, end / need);
    this.bufferPercent = Math.max(0, Math.min(99, Math.floor(ratio * 100)));


    /**
     * 够播了就撤掉提示。
     *
     * 正常播放中要求留 ≥1 秒余量；但**已经缓冲到片尾**时不存在「余量」这回事
     * （最后那零点几秒就是全部了），所以这时只要解码器就绪、还剩一点数据就撤，
     * 否则就会一直挂着一个 98% / 99% 的圈。
     */
    const atStreamEnd = duration > 0 && end >= duration - 0.5;
    const enough = el.readyState >= 3 && this.bufferSeconds >= (atStreamEnd ? 0.05 : 1);
    if (enough) {
      this.bufferPercent = 100;
      this.buffering = false;
      this.stopBufferTicker();
    }
  },




  /** 缓冲期间每 250ms 刷新一次数字（`progress` 事件在 MSE 下不一定会持续触发） */
  startBufferTicker(): void {
    if (this._bufferTimer) return;
    this._bufferTimer = setInterval(() => this.syncBufferState(), 250);
  },




  stopBufferTicker(): void {
    if (this._bufferTimer) {
      clearInterval(this._bufferTimer);
      this._bufferTimer = null;
    }
  },




  /**
   * 视频加载失败
   *
   * 修复要点：原来是无条件 `changeVideo(..., true)` 重试，没有计数上限，
   * 一旦解析始终失败就是死循环。这里加失败计数：
   *  - 先跳过缓存重试一次（原意图）
   *  - 仍失败则跳到下一首，并提示用户
   */
  async videoError(): Promise<void> {
    // 切歌时 this.queueStore.songName 立刻变成新歌，但 videoList 还是上一首的；
    // 这段窗口里旧视频元素报错不能算在新歌头上（否则会拿旧 bvid 重试，
    // 甚至把旧视频永久记到新歌名下），直接忽略。
    if (this.queueStore.videoListKeyword !== this.queueStore.songName) return;


    /**
     * dash（MSE）出错时先退回 durl，别直接判成「视频加载失败」。
     *
     * MSE 的失败面比单文件播放宽得多（编码不支持、某个分片拉取失败、
     * buffer quota 超限……），这些都不代表视频本身坏了。
     * 退回 720P 混流至少能正常看，比跳歌好得多。
     */
    if (this.dashSource) {
      this._videoErrorCount = 0;
      ElMessage.warning('高清流播放失败，已自动切回 720P');
      this.fallbackToDurl();
      return;
    }

    this._videoErrorCount += 1;
    const video = this.queueStore.videoList[this.queueStore.currentVideoIndex];
    if (this._videoErrorCount === 1 && video) {

      /**
       * 第一次失败：跳过缓存重新解析该视频
       *
       * 必须先把当前位置记下来：这是**同一个视频**重新解析地址（缓存过期 / 直链失效），
       * 换 `src` 会把播放位置清零 —— 不记的话用户听到的就是「重新解析后从头开始」。
       */
      this.rememberSeekPoint();
      await this.changeVideo(video.bvid, this.queueStore.videoListKeyword, { skipCache: true });
      return;
    }
    this._videoErrorCount = 0;
    /** 用显示名（`songName` 现在是缓存键，形如 `tx_xxx`，不能贴进提示） */
    ElMessage.warning(
      `《${this.queueStore.songName || '当前歌曲'}》视频加载失败，已跳过`,
    );
    if (this.queueStore.songs.length > 1) this.next();
  },




  onVideoLoaded(): void {
    const v = this.videoEl();
    if (v) {
      v.volume = this.currentVolume / 100;
      // 关键修复：原来只在 isMuted 为真时写 true，解除静音后不会写回 false，
      // 导致「图标显示有声、实际没声」。这里始终跟随当前状态赋值。
      v.muted = this.isMuted;

      /**
       * 续播 / 切清晰度后的定位
       *
       * `seekAfterLoad` 是**跨源共享**的字段，必须校验它是不是为「当前这首歌」设的：
       * 否则「在 140 秒处切清晰度 -> 流还没加载完就切了歌」会把新歌
       * 直接定位到 140 秒；新歌若比 140 秒短就越过 duration，
       * 表现成「画面不动 / 直接到底」。
       */
      if (this.seekAfterLoad > 0 && this.seekAfterLoadFor === this.queueStore.songName) {
        const target = this.seekAfterLoad;
        this.seekAfterLoad = 0;
        this.seekAfterLoadFor = '';

        /**
         * 目标点已经越过片尾就**别定位**：`currentTime` 在 duration 未知（MSE 早期是
         * 0 / Infinity）或上一次是坏源时可能很大，硬定位会「一进去就播完」甚至画面不动。
         */
        const dur = v.duration;
        if (Number.isFinite(dur) && dur > 0 && target >= dur - 1) {
          console.warn('[video] 记录的进度已超过片长，忽略定位:', target, dur);
        } else {
          try {
            v.currentTime = target;
          } catch {
            /* 某些格式不支持 seek，忽略 */
          }
        }
      } else {
        // 不是给这首歌设的，直接丢掉，别让它污染下一首
        this.seekAfterLoad = 0;
        this.seekAfterLoadFor = '';
      }
      this._videoErrorCount = 0;
      // 新的源开始了：片尾看门狗与停滞看门狗的状态一起复位
      this._endStallHandled = false;
      this._stallSince = 0;
      this._stallRecoveries = 0;

      /**
       * 卡顿恢复链的两个计数器也要归零
       *
       * ⚠️ **只在这里归零**（新视频真正开始播），不在 `applyVideoSource` 里：
       * 那个函数在「换备用源 / 降 durl」时也会被调用 —— 如果在那里归零，
       * 换源后计数器清零，就会**永远在第一个备用源上打转**，降级链走不下去。
       */
      this._stallUrlIndex = 0;
      this._stallQualityDrops = 0;
      this._progressPos = 0;
      this._lastProgressAt = Date.now();
      // 如果这次切进来的正是预热过的那首，对应槽位就作废了
      this.dropWarmIfCurrent();
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
    // this.paused 必须跟着 <video> 走：它原先只在切歌/清空那几处被赋值，
    // 播完一首或元素自己暂停时不会更新，于是图标和托盘仍显示「正在播放」，
    // 用户第一次点播放键只是把它翻成 true（pause 空操作），要点第二次才真的重播。
    const v = this.videoEl();
    if (v) this.paused = v.paused;

    /**
     * ★ 立刻同步定时器状态（不要等下一秒的 tick）
     *
     * 踩过：冻结判断只在每秒 tick 里做，于是**点暂停后倒计时还会多跑一秒**
     * —— 用户在 `xx:59.1` 暂停，下一次 tick 在 `xx:00.0` 才切成冻结，
     * 那一刻剩余时间已经从 59 掉到 58。
     * 在 `play` / `pause` 事件里直接同步，冻结就发生在事件那一刻。
     */
    this.sleepStore._sleepTimer?.syncNow();
    this.syncTrayState();
    this.updateMediaSession();
  },




  videoUpDate(): void {
    const v = this.videoEl();
    if (!v) return;
    this.currentTime = v.currentTime;
    this.duration = v.duration;
    // 记录「播放位置最后一次前进」的时间，片尾看门狗靠它判断是不是真的卡住了
    if (v.currentTime - this._progressPos > 0.05) {
      this._progressPos = v.currentTime;
      this._lastProgressAt = Date.now();
    }
    // 少数源在 loadeddata 时尺寸还没就绪，这里补一次（拿到就不再重复算）
    if (!this.videoQuality) this.syncVideoQuality();
    // 节流记录播放进度，供下次续播
    this.persistPlaybackStateThrottled();
    // 同步系统媒体控件的进度条
    this.updateMediaPositionThrottled();

    /**
     * 托盘菜单开着时把进度推过去（菜单里那条进度条要动）
     *
     * 只在菜单开着时推：平时推是白费 IPC（`timeupdate` 一秒好几次）。
     */
    if (this.trayMenuOpen && Date.now() - this._lastTraySyncAt > 300) {
      this._lastTraySyncAt = Date.now();
      this.syncTrayState();
    }
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
    if (this.currentMode == this.queueStore.MODE.single) {
      // 单曲循环：真的把播放位置拨回 0 再播，只改 this.currentTime 是没用的
      // （<video> 播完就停在末尾，UI 还会一直显示「正在播放」）
      const v = this.videoEl();
      this.currentTime = 0;
      if (v) {
        try {
          v.currentTime = 0;
        } catch {
          /* 不支持 seek 就退化成重载 */
        }
        void v.play().catch(() => {});
      }

      /**
       * 看门狗状态必须一起复位
       *
       * 单曲循环走的是「拨回 0 再 play」，不会重新触发 `loadeddata`，
       * 也就是 `onVideoLoaded` 里那次复位不会发生 —— 而 `checkEndOfStream` 第一行就是
       * `if (this._endStallHandled) return`。不复位的话，第二圈开始片尾看门狗永久失效，
       * 「播到最后一秒卡住」会原样重现。
       */
      this._endStallHandled = false;
      this._progressPos = 0;
      this._lastProgressAt = Date.now();
      this._stallSince = 0;

      /**
       * 恢复链的两个计数器也复位：这一圈是**新的一次播放**，
       * 从主地址重新试起，降清晰度的额度也重新给满。
       * （跟 `onVideoLoaded` 里那处是同一个道理，只是单曲循环走不到那里。）
       */
      this._stallUrlIndex = 0;
      this._stallQualityDrops = 0;
      this.paused = false;
      this.syncTrayState();
      this.updateMediaSession();
    } else {
      this.next();
    }
  },




  /** 循环模式：字符串枚举 -> 数字下标（供 biliVideoControls 使用） */
  loopModeToIndex(mode: AppSetting['player.loopMode']): number {
    const idx = PLAY_LOOP_MODES.indexOf(mode);
    return idx >= 0 ? idx : this.queueStore.MODE.read;
  },




  /**
   * 清掉「正在播放」的视频信息
   *
   * 切歌单 / 歌单被删光 / 从管理弹窗点播时都要清一遍。集中在一处，
   * 免得以后新增字段又忘了清（控制栏手动挑的 `selectedQn` / `selectedAudioId`
   * 就是这么漏掉过：换歌后还沿用上一首的档位）。
   */
  clearNowPlaying(): void {
    this.stopDashSession();
    // 真把上一首停下来：只清字段的话 <video> 会继续播旧流，
    // 界面显示新歌名、耳朵里还是上一首
    const v = this.videoEl();
    if (v) {
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* 忽略 */
      }
    }
    this.videoUrl = '';
    this.dashSource = null;
    this.queueStore.currentBvid = '';
    this.videoName = '';
    this.videoPic = '';
    this.videoQuality = '';
    this.videoQualityDesc = '';
    this.audioQuality = '';
    this.audioQualityDesc = '';
    this.qualityOptions = null;
    this.videoQualityPixels = '';
    this.selectedQn = null;
    this.selectedAudioId = null;
    this.currentTime = 0;
    this.duration = 0;
    this.paused = true;
    // 失败计数属于上一首，留着会让新歌的第一次错误被当成第二次（直接跳歌）
    this._videoErrorCount = 0;
    // 任务栏进度也跟着清掉（没有在播的东西了）
    this.updateTaskbarProgress();
    // 片尾/停滞看门狗的状态也属于上一首：换源时重新计时
    this._endStallHandled = false;
    this._stallSince = 0;
    this._stallRecoveries = 0;
    /** 恢复链的两个计数器同理：没有在播的流了，谈「试到第几个源」没有意义 */
    this._stallUrlIndex = 0;
    this._stallQualityDrops = 0;
    this._progressPos = 0;
    this._lastProgressAt = Date.now();

    /**
     * 缓冲 UI 也要一起清干净
     *
     * 踩过：这里只清视频元素，`buffering` / 百分比 / ticker 都留着 ——
     * 元素被 removeAttribute('src') + load() 之后 readyState = 0、buffered 为空，
     * `syncBufferState` 的「够播了」永远不成立，于是缓冲圈以 0% 永久挂在屏幕上，
     * 250ms 的 ticker 也一直空转。触发路径很常见：搜索失败、歌单删空、没搜到视频。
     */
    this.clearBufferOverlayTimer();
    this.stopBufferTicker();
    this.buffering = false;
    this.bufferPercent = 0;
    this.bufferSeconds = 0;
    // 预热结果（含隐藏的预热流）属于上一首的上下文，一起清掉
    this.clearAllWarm();
    this.syncTrayState();
  },




  playCurrent(seekTo = 0): void {
    if (this.queueStore.songs.length === 0) return;
    // 续播时把起播点传给 changeSong，视频加载完成后会 seek 过去
    if (seekTo > 0) {
      this.seekAfterLoad = seekTo;
      this.seekAfterLoadFor = this.queueStore.getSongName(this.queueStore.currentIndex) ?? '';
    }
    this.changeSong(this.queueStore.currentIndex);
    this.queueStore.resetRandomList();
    // 记录当前播放信息（歌单 / 下标 / 进度）
    void this.persistPlaybackState();
    nextTick(() => {
      const v = this.videoEl();
      if (v) {
        v.volume = this.currentVolume / 100;
      }
    });
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
    const song = this.queueStore.getSong(this.queueStore.currentIndex);

    /**
     * ⚠️ 兜底**不能**用 `this.queueStore.songName`（那是缓存键 `tx_7062415`）——
     * 它会被 Windows 音量弹窗 / 锁屏界面显示出来，用户看到一串 ID。
     * 用显示名兜底。
     */
    const title = song?.name || this.videoName || this.queueStore.songName || 'B站音乐视频';

    /**
     * 变量按项目惯例叫 `singer`
     *
     *（MediaMetadata 那个字段叫 `artist`，是**它的** API 名字 ——
     * 下面构造时才写成 `artist: singer`，不让它污染我们的变量名）
     */
    const singer = song?.singer || this.sessionStore.userName || '未知歌手';
    const album = song?.album || this.queueStore.listName || '';

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
        /** `artist` 是 MediaMetadata 的字段名 —— 值取我们的 `singer` */
        artist: singer,
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




  /**
   * 记录当前播放信息（歌单 / 歌曲下标 / 视频 / 进度）
   *
   * 触发点：切歌、切视频、视频加载完成、时间更新（节流）。
   */
  async persistPlaybackState(): Promise<void> {
    const record = this.playlistsStore.current;
    if (!record) return;
    const patch: Partial<AppSetting> = {
      'player.resumeTime': Math.floor(this.currentTime || 0),
    };
    void this.settingStore.update(patch);
    // 歌单自己播到第几首（切歌单时用于回到各自的位置）
    void this.playlistsStore.setLastIndex(this.queueStore.currentIndex);
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
    this.updateTaskbarProgress();
  },




  /**
   * 任务栏进度条（Windows 任务栏图标上的那条）
   *
   * 只在「百分比或暂停状态真的变了」时才发 IPC：`timeupdate` 一秒好几次，
   * 每次都发会把主进程喊爆。
   */
  updateTaskbarProgress(): void {
    const total = this.duration || 0;
    const progress = total > 0 ? (this.currentTime || 0) / total : -1;
    // 设置里关掉、或者没有在播 -> 清掉进度条
    const enabled = this.settingStore.setting['common.taskbarProgress'];
    const value = !enabled || (!this.videoUrl && !this.dashSource) ? -1 : progress;
    const key = value < 0 ? 'none' : `${Math.round(value * 200)}|${this.paused}`;
    if (key === this._lastTaskbarKey) return;
    this._lastTaskbarKey = key;
    void electronApi.setProgress(value, this.paused);
  },




  /**
   * 声音输出设备变化时暂停播放（设置项 `player.pauseOnDeviceChange`）
   *
   * 插拔耳机、切换默认输出设备时，正在播的音频有可能会跑到另一个设备上，
   * 所以先暂停，等用户自己决定继续。（`devicechange` 不区分输入/输出设备，
   * 这是渲染进程能拿到的唯一信号。）
   */
  onAudioDeviceChange(): void {
    if (!this.settingStore.setting['player.pauseOnDeviceChange']) return;
    if (this.paused) return;
    this.playControl();
    ElMessage.info('检测到声音输出设备变化，已暂停播放');
  },




  syncTrayState(): void {
    // 托盘显示的是「歌曲名 - 歌手名」，不是视频标题（视频标题太长了）
    const song = this.queueStore.getSong(this.queueStore.currentIndex);

    /**
     * ⚠️ 兜底用 `songLabel`（显示名），**不是** `songName`（缓存键 `tx_xxx`）——
     * 后者会出现在托盘悬浮提示上，用户看到一串 ID。
     */
    const title = song
      ? song.singer
        ? `${song.name} - ${song.singer}`
        : song.name
      : this.queueStore.songName;
    electronApi.trayUpdateState({
      paused: this.paused,
      // 托盘契约用字符串枚举的循环模式（与持久化的 player.loopMode 一致）
      loopMode: PLAY_LOOP_MODES[this.currentMode] || 'listLoop',
      title,
      // 托盘菜单是个迷你控制台：进度条与音量跟着实时走
      position: this.currentTime || 0,
      duration: this.duration || 0,
      volume: this.currentVolume,
      muted: this.isMuted,
      // 登录态一起带上，防主进程那份和这边不一致
      isLoggedIn: this.sessionStore.isLoggedIn,

      /**
       * 定时倒计时（托盘菜单里那一项要显示）
       *
       * 用 `ceil` 是为了和界面上的 `formatRemain` 对齐：剩 0.4 秒时两边都显示 `00:01`，
       * 不会出现「弹窗还有 1 秒、托盘已经 00:00」。
       */
      sleepActive: this.sleepStore.sleepState.active,
      sleepRemainSec: Math.ceil(Math.max(0, this.sleepStore.sleepState.remainMs) / 1000),
    });
  },




  /**
   * 取 <video> 元素
   *
   * Vue 的 $refs 是无类型的，这里统一收口成一个小工具方法，
   * 避免每处都写 (this.$refs.video as HTMLVideoElement)。
   */
  videoEl(): VideoElement | null {
    return this._videoHolder.el;
  },




  /**
   * **结果被过滤规则全部挡掉**时的提示
   *
   * 和 `notifySearchEmpty`（搜索真失败）是两件事，所以提示也要分开：
   * 这里搜索是成功的，问题出在**过滤规则太严**，解决办法是去设置里放宽。
   * 说成「网络有问题」会让用户白折腾半天。
   */
  notifyFilteredEmpty(songName: string): void {
    ElNotification({
      title: `《${songName}》的结果都被过滤掉了`,
      message:
        '搜索是成功的，但结果都不符合当前的过滤规则（标题不含歌名 / 时长差太多 / 命中过滤关键词）。' +
        '可以去「设置 → 搜索」里放宽时长容差或删掉一些过滤关键词。',
      type: 'warning',
      duration: 9000,
    });
  },




  /**
   * 搜索没结果时的提示
   *
   * 分两种情况说，因为**解决办法完全不同**：
   *  - 未登录：提示去登录（登录后能搜到的确实更多）；
   *  - 已登录：更可能是本机网络 / 代理的问题，提示检查网络。
   *
   * ⚠️ 文案里**不要提「重试了几次」**（现在的代码根本不重试，
   * 说重试过是假话）；也**不要描述 B 站的返回机制**
   * （「只返回部分结果」这种说法把内部行为写在用户屏幕上，没必要）——
   * 只说「登录后通常能找到」就够了。
   *
   * 用 `$notify`（右上角浮层）而不是 `$message`（一闪而过的 toast）：
   * 这两句话都带操作指引，用户需要时间读，而且要点右上角头像去登录。
   */
  notifySearchEmpty(songName: string): void {
    if (!this.sessionStore.isLoggedIn) {
      ElNotification({
        title: `《${songName}》没有找到视频`,
        message: '登录后再试一次，通常就能找到了。点右上角头像登录。',
        type: 'warning',
        duration: 8000,
      });
      return;
    }
    ElNotification({
      title: `《${songName}》没有找到视频`,
      message: '请检查一下网络连接（或代理 / VPN）是否正常，稍后再试。',
      type: 'error',
      duration: 8000,
    });
  },
  },
});
