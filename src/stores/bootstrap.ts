import { watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { VideoElement, BiliVideo } from '../types/app';
import type { SyncResult } from '@common/types/playlist';
import electronApi from '../api/electron';
import defaultSetting from '@common/defaultSetting';
import { useSettingStore } from './setting';
import { usePlaylistStore } from './playlists';
import { useUiStore } from './ui';
import { useQueueStore } from './queue';
import { usePlaybackStore } from './playback';
import { useWindowStore } from './window';
import { useSessionStore } from './session';
import { useSystemStore } from './system';
import { useSleepStore } from './sleep';

/**
 * 启动编排（不是 store）
 *
 * 这里做的是「把几个 store 串起来」：读配置、恢复上次的歌、挂监听、收摊。
 * 它天然要碰到所有 store —— 如果做成 store，就会变成新的上帝对象，
 * 所以刻意保持为普通模块：没有响应式状态，方法之间靠 this 互调。
 *
 * 调用方只关心三个入口：attachVideo / bootstrap / teardown。
 */
export const boot = {

  /** 定时自动同步的定时器 */
  _syncTimer: null as ReturnType<typeof setInterval> | null,


  /** 定时器对应的「策略指纹」，用来避免被无关的配置广播反复重建 */
  _syncKey: '',


  _stopWatchers: [] as (() => void)[],



  /**
   * 左上角刷新（两个列表共用一个按钮）
   *
   * 歌曲列表 -> 重新同步当前歌单；视频列表 -> 重新搜索这首歌（收藏仍在最前面）。
   */
  async onListRefresh(): Promise<void> {
    if (useUiStore().listType === 'list') {
      const id = usePlaylistStore().currentId;
      if (!id) return;
      try {
        const results = await usePlaylistStore().sync([id]);
        await this.reportSyncResults(results, '同步');
        await this.reloadCurrentPlaylistSongs();
      } catch (err) {
        ElMessage.error('同步失败：' + useUiStore().errMsg(err));
      }
      return;
    }
    await useQueueStore().refreshVideoList();
  },



  async init(): Promise<void> {
    // 用主进程下发（Pinia 中）的配置初始化本地播放状态
    const cfg = useSettingStore().setting;
    usePlaybackStore().currentVolume = cfg['player.volume'];
    usePlaybackStore().isMuted = cfg['player.isMute'];
    // 记录初始非零音量，保证「静音 -> 解除」能恢复到本次会话的实际音量
    usePlaybackStore().lastNonZeroVolume = cfg['player.volume'] > 0 ? cfg['player.volume'] : defaultSetting['player.volume'];
    usePlaybackStore().currentMode = usePlaybackStore().loopModeToIndex(cfg['player.loopMode']);

    useWindowStore().isMaximized = await electronApi.winIsMaximized();
    useWindowStore().isFullscreen = await electronApi.winIsFullscreen();
    useSessionStore().loadUserInfo();
    usePlaybackStore().syncTrayState();
    // 接上 Windows 系统媒体控件（SMTC）：媒体键 + 系统音量弹窗里的媒体信息
    useSystemStore().setupMediaSessionActions();
    usePlaybackStore().updateMediaSession();

    // 加载歌单集合（旧版单歌单文件已由主进程迁移进集合）
    try {
      await usePlaylistStore().load();
    } catch (err) {
      ElMessage.error('加载歌单失败：' + useUiStore().errMsg(err));
    }

    // 后台做启动同步，不阻塞续播
    void this.runStartupSync();
    // 按歌单的定时同步策略装心跳（记下指纹，免得后续无关的配置广播重建它）
    this._syncKey = `${usePlaylistStore().hasIntervalSync}|${usePlaylistStore().minSyncInterval}`;
    this.setupSyncTimer();

    // 优先续播；没有可续播内容时退回「当前歌单的第一首」
    const resumed = await this.tryResume();
    if (!resumed) await this.loadPlaylist();
  },




  /** 启动时按设置自动同步歌单（失败只提示，不打断启动） */
  async runStartupSync(): Promise<void> {
    try {
      const results = await usePlaylistStore().syncOnStartupIfNeeded();
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
        ElMessage.success(
          `${label}完成 ${okList.length} 个` + (detail ? `（${detail}）` : '，无变化'),
        );
      }
    }
    for (const r of failed) {
      ElMessage.warning(`${r.name} ${label}失败：${r.error ?? '未知错误'}`);
    }
    // 曲目列表变了：重载当前播放列表，保证播放的不是过期数据
    if (changed.length > 0 && useQueueStore().songs.length > 0) {
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
    if (!usePlaylistStore().hasIntervalSync) return;
    // 兜底 5 分钟，避免配置成极小值导致疯狂请求
    const interval = Math.max(5 * 60 * 1000, usePlaylistStore().minSyncInterval || 0);
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
    if (usePlaylistStore().isSyncing) return;
    const dueIds = usePlaylistStore().getDueSyncIds();
    if (dueIds.length === 0) return;
    try {
      const results = await usePlaylistStore().sync(dueIds);
      // 无变化时静默，避免每次心跳都弹提示
      await this.reportSyncResults(results, '定时同步', true);
    } catch (err) {
      console.warn('[sync] 定时同步失败', err);
    }
  },




  /** 把 store 里当前歌单的曲目同步到本地播放列表（保留当前下标，越界则归零） */
  async reloadCurrentPlaylistSongs(): Promise<void> {
    const record = usePlaylistStore().current;
    if (!record) return;
    const keepIndex = useQueueStore().currentIndex;
    useQueueStore().songs = [...record.songs];
    useQueueStore().listName = record.name;
    // 曲目变了，随机播放的下标表必须跟着重建：
    // 否则同步后曲目变少，随机列表里还留着越界下标，「下一首」会拿到 null 静默不动
    useQueueStore().resetRandomList();
    // 预热槽位按下标算，曲目一变就全部作废
    usePlaybackStore().clearAllWarm();
    if (useQueueStore().songs.length === 0) return;
    if (keepIndex >= useQueueStore().songs.length) {
      useQueueStore().currentIndex = 0;
      await usePlaybackStore().playCurrent();
    }
  },




  /**
   * 续播：恢复上次的歌单 / 歌曲 / 视频 / 播放进度
   *
   * @returns 是否成功恢复（false 表示调用方应走默认加载流程）
   */
  async tryResume(): Promise<boolean> {
    if (!useSettingStore().setting['player.resumeOnStart']) return false;
    const record = usePlaylistStore().current;
    if (!record || record.songs.length === 0) return false;


    /**
     * 回到该歌单上次播放的位置
     *
     * ⚠️ 下标本身会**被同步改变含义**（曲目增删后第 N 个位置可能是别的歌），
     * 所以主进程在 `syncPlaylist` 里会把它**重算**成新列表里的位置 ——
     * 这里只需要夹进范围。
     */
    const index = Math.min(Math.max(0, record.lastIndex), record.songs.length - 1);
    useQueueStore().songs = [...record.songs];
    useQueueStore().listName = record.name;
    useQueueStore().currentIndex = index;

    const songName = useQueueStore().getSongName(index);
    if (!songName) return false;

    const resumeTime = useSettingStore().setting['player.resumeTime'] || 0;

    try {
      // 「记住播放进度」一个开关管到底：歌 + 进度一起回来
      if (await this.restoreSongVideo(index, resumeTime)) {
        ElMessage.success(
          `已续播《${useQueueStore().listName}》第 ${index + 1} 首` +
            (resumeTime > 3 ? `（${usePlaybackStore().formatTime(resumeTime)}）` : ''),
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
   * 直接走一次正常搜索把候选列表铺满 —— 这首歌上次就是「正在播」的那首，
   * `api:searchSong` 基本命中主进程的搜索结果缓存（数据库命中，秒回），
   * 所以没必要为了省这一趟请求让 `videoList` 只放一条占位
   * （那样续播后点开视频列表只有孤零零一行）。
   *
   * 播哪个视频以主进程记的 `selectedBvid`（`song_meta` 表）为准，
   * 而且直链一律交给 `api:resolveVideo` 现取：缓存里的地址可能早就过了签名时效。
   *
   * @param index  要恢复的那首歌的下标（歌名/歌手/缓存键都由它推出来）
   * @param seekTo 播放起点（秒），0 表示从头
   * @returns 是否成功
   */
  async restoreSongVideo(index: number, seekTo = 0): Promise<boolean> {
    const songName = useQueueStore().getSongName(index);
    const parts = useQueueStore().getSongParts(index);
    if (!songName || !parts) return false;

    /**
     * 没有「上次播的视频」记录 -> 交给默认流程
     *
     * 这一条以前查的是歌单里的 `videoCache`，现在换成主进程的
     * `song_meta.selected_bvid`。语义没变：**没有记录就说明这首歌从没播过**，
     * 此时应该走 `loadPlaylist` 那套（它会播搜索结果里的第一个），
     * 而不是在这里造一个「随便挑一个」的行为 —— 两条路径都得挑第一个的话，
     * 不如只留一条，省得以后改挑选规则时漏改一处。
     */
    let remembered: string | null = null;
    try {
      remembered = await electronApi.getSelectedBvid(songName);
    } catch (err) {
      console.warn('[resume] 读取上次播放的视频失败，回退到默认流程', err);
    }
    if (!remembered) return false;
    const cachedBvid = remembered;

    // 歌曲信息先切过来：搜索往返期间界面显示的也该是这首歌
    useQueueStore().songName = songName;

    try {
      const res = await useUiStore().withNet(() => electronApi.searchSong(parts.song, parts.singer));
      const videos = (res.data as { result?: BiliVideo[] } | null)?.result ?? [];

      /**
       * 顺序已经是最终顺序 —— 主进程 `rankVideos` **在写库之前**排好的
       * （收藏整段置顶，其余按「歌手名命中 +100」再叠关键词加权）。
       * 渲染层**不再排序**，直接用返回的顺序。
       */
      useQueueStore().videoList = videos;
      useQueueStore().videoListKeyword = songName;
    } catch (err) {
      // 搜索失败不致命：至少还能把记住的那个视频播起来
      console.warn('[resume] 搜索失败，只按记住的视频续播', err);
      useQueueStore().videoList = [];
    }

    if (seekTo > 0) {
      usePlaybackStore().seekAfterLoad = seekTo;
      usePlaybackStore().seekAfterLoadFor = songName;
    }

    // 交给 changeVideo 解析并起播：它顺手回填标题/封面/清晰度，地址过期会自动重取
    await usePlaybackStore().changeVideo(cachedBvid, songName);
    if (useQueueStore().currentBvid === cachedBvid && (usePlaybackStore().videoUrl || usePlaybackStore().dashSource)) {
      // 记住的视频不在这轮搜索结果里 -> 补成列表第一项，别让「正在播的」在列表里找不到
      if (useQueueStore().currentVideoIndex < 0) {
        useQueueStore().videoList = [
          { bvid: cachedBvid, title: usePlaybackStore().videoName, pic: usePlaybackStore().videoPic || null },
          ...useQueueStore().videoList,
        ];
        useQueueStore().currentVideoIndex = 0;
      }
      return true;
    }

    // 记住的视频已经播不了（被删 / 换源）-> 退回搜索结果第一条
    const first = useQueueStore().videoList[0];
    if (!first || first.bvid === cachedBvid) return false;
    console.warn('[resume] 记住的视频已失效，改用搜索结果第一条', first.bvid);
    await usePlaybackStore().changeVideo(first.bvid, songName);
    return Boolean(usePlaybackStore().videoUrl || usePlaybackStore().dashSource);
  },




  /**
   * 加载当前歌单的曲目
   *
   * 多歌单之后，曲目来源是 playlists store 的「当前歌单」，
   * 不再直接读旧版单歌单文件（那个文件已由主进程迁移进集合）。
   */
  async loadPlaylist(): Promise<void> {
    const record = usePlaylistStore().current;
    if (record && record.songs.length > 0) {
      useQueueStore().listName = record.name;
      useQueueStore().songs = [...record.songs];
      /** 回到该歌单上次播放的位置（下标由主进程在同步时重算，这里夹进范围） */
      useQueueStore().currentIndex = Math.min(Math.max(0, record.lastIndex), useQueueStore().songs.length - 1);
      // 兼顾「播放进度」：走这条兜底路径时（没有已缓存的视频可精确还原）
      // 也要把上次的秒数带上，否则换歌单/首启场景会丢掉进度
      const cfg = useSettingStore().setting;
      const resumeTime =
        cfg['player.resumeOnStart'] ? Number(cfg['player.resumeTime']) || 0 : 0;
      void usePlaybackStore().playCurrent(resumeTime > 3 ? resumeTime : 0);
      return;
    }
    // 没有任何歌单：直接打开歌单管理，让用户在里面新建
    useUiStore().playlistManagerVisible = true;
  },




  /** 从歌单管理弹窗里点某首歌播放
   *
   * 弹窗内部已负责把该歌单设为当前，这里只需加载曲目并起播。
   */
  async onPlayFromManager(index: number): Promise<void> {
    const record = usePlaylistStore().current;
    if (!record || record.songs.length === 0) return;
    useQueueStore().songs = [...record.songs];
    useQueueStore().listName = record.name;
    useQueueStore().currentIndex = Math.min(Math.max(0, index), useQueueStore().songs.length - 1);
    usePlaybackStore().seekAfterLoad = 0;
    usePlaybackStore().seekAfterLoadFor = '';
    useQueueStore().videoList = [];
    useQueueStore().videoListKeyword = '';
    usePlaybackStore().clearNowPlaying();
    useQueueStore().songName = '';
    void usePlaybackStore().playCurrent();
  },




  /** 从歌单面板切换歌单 */
  async onPlaylistSwitch(id: string | null): Promise<void> {
    if (!id) {
      // 歌单被删光了
      useQueueStore().songs = [];
      useQueueStore().videoList = [];
      useQueueStore().videoListKeyword = '';
      useQueueStore().listName = '';
      useQueueStore().currentIndex = 0;
      useQueueStore().currentVideoIndex = 0;
      useQueueStore().songName = '';
      usePlaybackStore().clearNowPlaying();
      useUiStore().playlistManagerVisible = true;
      return;
    }
    const record = usePlaylistStore().current;
    if (!record) return;
    // 防御：弹窗有时只想「刷新」却发成了 switch。currentId 没变就说明不是真的切换，
    // 只重载曲目、别把正在听的歌从头重播
    if (id !== usePlaylistStore().currentId) {
      await this.reloadCurrentPlaylistSongs();
      return;
    }

    // 换歌单时把进度重置，避免把上一个歌单的秒数带到新歌单
    useQueueStore().songs = [...record.songs];
    useQueueStore().listName = record.name;
    useQueueStore().currentIndex = Math.min(Math.max(0, record.lastIndex), Math.max(0, record.songs.length - 1));
    useQueueStore().videoList = [];
    useQueueStore().videoListKeyword = '';
    useQueueStore().currentVideoIndex = 0;
    usePlaybackStore().clearNowPlaying();
    useQueueStore().songName = '';
    usePlaybackStore().currentTime = 0;
    usePlaybackStore().seekAfterLoad = 0;
    usePlaybackStore().seekAfterLoadFor = '';
    await useSettingStore().update({
      'player.resumeTime': 0,
    });

    if (useQueueStore().songs.length === 0) {
      ElMessage.warning(`《${record.name}》还没有曲目，可以先「同步」一下`);
      return;
    }
    ElMessage.success(`已切换到《${record.name}》（${useQueueStore().songs.length} 首）`);
    void usePlaybackStore().playCurrent();
  },



  /**
   * 注入 `<video>` 元素
   *
   * 组件挂载后立刻调用。原来是 `videoEl()` 里直接读 `this.$refs.video`，
   * 但 ref 属于组件实例，store 拿不到 —— 只能由组件在挂载时交进来。
   */
  attachVideo(el: VideoElement | null): void {
    usePlaybackStore()._videoHolder.el = el;
  },




  /**
   * 启动（原来是 `mounted` 的全部内容）
   *
   * 顺序有意义：先 `init()` 把播放状态准备好，再挂监听 ——
   * 反过来的话，第一次托盘事件可能早于状态就绪，读到的 `duration` 是 0。
   */
  bootstrap(): void {

    /**
     * 三个 watch（原来写在组件 `watch:` 选项里）
     *
     * 搬进来用函数式注册，返回的 stop 存起来给 `teardown()` 用。
     * 组件现在随时可能被卸载重建（dev 热更新就是），没有 stop 会越挂越多。
     */
    this._stopWatchers.push(

      /**
       * 进壁纸模式就先把所有弹窗收掉
       *
       * 踩过：壁纸模式下窗口在桌面层、标题栏和控制栏都隐藏了，弹窗却还开着 ——
       * 它既点不动也关不掉，用户只能先回窗口模式关掉它再重新进壁纸模式。
       * 所以只要 `wallpaperEnabled` 变 true，就把列表 / 歌单管理 / 设置 / 关于 / 添加视频全关掉。
       */
      watch(
        () => useWindowStore().wallpaperEnabled,
        (enabled: boolean): void => {
          if (!enabled) return;
          useUiStore().listType = 'none';
          useUiStore().playlistManagerVisible = false;
          useUiStore().settingsVisible = false;
          useUiStore().aboutVisible = false;
          useUiStore().addVideoVisible = false;
        },
      ),
    );
    this._stopWatchers.push(

      /**
       * 全屏 -> 自动锁定（设置里开关，默认关）
       *
       * 进全屏时锁上、退出全屏时解开，但**只动「因全屏而锁」的那次**：
       * 用户自己按 S 锁的，退出全屏不该替他解开。
       */
      watch(
        () => useWindowStore().isFullscreen,
        (full: boolean): void => {
          if (full) {

            /**
             * 只有**本次真的由全屏触发了锁定**才记来源
             *
             * 用户可能自己按 S 锁着再进全屏：这时不能把「解锁的责任」算在全屏头上，
             * 否则退出全屏会替他解开（与这段的初衷相反）。
             */
            if (useSettingStore().setting['player.lockOnFullscreen'] && !useWindowStore().locked) {
              useWindowStore()._lockedByFullscreen = true;
              useWindowStore().toggleLock(true);
            }
            return;
          }
          if (useWindowStore()._lockedByFullscreen) {
            useWindowStore()._lockedByFullscreen = false;
            if (useWindowStore().locked) useWindowStore().toggleLock(false);
          }
        },
      ),
    );
    this._stopWatchers.push(

      /**
       * 配置可能在别处被改动（多窗口同步、托盘、恢复默认），
       * 所以要把 Pinia 里的音量/静音同步回本地播放状态，并作用到 <video> 上。
       *
       * 用 !== 判断避免与「用户改音量 -> 写回主进程 -> 广播回来」形成回环。
       */
      watch(
        () => useSettingStore().setting,
        (): void => {
          const cfg = useSettingStore().setting;
          if (cfg['player.volume'] !== usePlaybackStore().currentVolume) {
            usePlaybackStore().currentVolume = cfg['player.volume'];
          }
          if (cfg['player.isMute'] !== usePlaybackStore().isMuted) {
            usePlaybackStore().isMuted = cfg['player.isMute'];
          }
          const v = usePlaybackStore().videoEl();
          if (v) {
            v.volume = usePlaybackStore().currentVolume / 100;
            v.muted = usePlaybackStore().isMuted;
          }
          // 定时同步策略挂在每个歌单上：只有「有没有定时歌单 / 最小间隔」变了才重建定时器。
          // 以前是无条件 setupSyncTimer()，而它会先 clear 再 setInterval ——
          // 播放中每 5 秒就会广播一次 player.resumeTime，于是定时器被无限推迟，30 分钟的心跳永远等不到。
          const syncKey = `${usePlaylistStore().hasIntervalSync}|${usePlaylistStore().minSyncInterval}`;
          if (syncKey !== this._syncKey) {
            this._syncKey = syncKey;
            this.setupSyncTimer();
          }
          // 任务栏进度开关可能刚被关掉：立刻把进度条清掉（不然要等下一次 3 秒节流）
          usePlaybackStore().updateTaskbarProgress();
        },
        { deep: true },  // 整个 setting 对象，漏了 deep 就只在整包替换时才触发
      ),
    );

  void this.init();
  useSessionStore().removeLoginListener = electronApi.onLoginSuccess(() => {
    void useSessionStore().onLoggedIn();
  });
  useSessionStore().removeLogoutListener = electronApi.onLogout(() => {
    useSessionStore().isLoggedIn = false;
    useSessionStore().userFace = '';
    useSessionStore().userName = '';
  });
  useSystemStore().removeTrayPlayControl = electronApi.onTrayPlayControl(() => {
    usePlaybackStore().playControl();
  });
  useSystemStore().removeTrayPrev = electronApi.onTrayPrev(() => {

    /**
     * ★ 托盘切歌也要守 `netBusy`（用户要求「托盘控制栏能 ban 一起 ban」）
     *
     * 托盘菜单是个迷你控制台，连点它和连点控制栏的「上一首」是**同一件事**：
     * 每次都会重新搜索 + 解析地址。请求在飞的时候直接忽略，
     * 免得和屏幕上的控制栏一样把请求叠加起来。
     *
     * ⚠️ 只拦**会发请求**的（上一首 / 下一首）。播放暂停、音量、进度、
     * 静音这些**本地操作照常** —— 用户不该因为后台在搜歌就不能暂停。
     */
    if (useUiStore().netBusy) return;
    usePlaybackStore().prev();
  });
  useSystemStore().removeTrayNext = electronApi.onTrayNext(() => {
    /** 同上：切歌会发请求，`netBusy` 时忽略 */
    if (useUiStore().netBusy) return;
    usePlaybackStore().next();
  });
  useSystemStore().removeTrayToggleMode = electronApi.onTrayToggleMode(() => {
    usePlaybackStore().toggleMode();
  });
  // 托盘菜单上的进度条 / 音量（菜单是个迷你控制台）
  useSystemStore().removeTraySeek = electronApi.onTraySeek((ratio) => {
    const total = usePlaybackStore().duration || 0;
    if (total > 0) usePlaybackStore().changeTime(Math.min(total, Math.max(0, ratio * total)));
  });
  useSystemStore().removeTrayVolume = electronApi.onTrayVolume((volume) => {
    usePlaybackStore().changeVolume(volume);
  });
  useSystemStore().removeTrayToggleMute = electronApi.onTrayToggleMute(() => {
    usePlaybackStore().toggleMute();
  });
  useSystemStore().removeTrayShowPlaylist = electronApi.onTrayShowPlaylist(() => {
    // 托盘「设置歌单」-> 直接打开统一的歌单管理弹窗
    useUiStore().playlistManagerVisible = true;
  });
  useSystemStore().removeTrayShowSleepTimer = electronApi.onTrayShowSleepTimer(() => {

    /**
     * 托盘「定时」-> 打开定时面板
     *
     * 和「设置歌单」同一条路径：主进程已经先把窗口从壁纸层/托盘里叫回来了，
     * 这里只负责把面板弹出来。
     */
    useUiStore().sleepPanelVisible = true;
  });
  useSystemStore().removeTrayShowLogoutConfirm = electronApi.onTrayShowLogoutConfirm(
    () => {
      useSessionStore().handleLogoutConfirm();
    },
  );

  /**
   * 左键点托盘图标 = 回到窗口 + 解锁
   *
   * 窗口模式 + 锁定状态下，界面只剩左下右下两个角按钮，用户自然会去点托盘；
   * 这里用 `toggleLock(false)`（幂等）：没锁就什么都不做，也不会多弹一条提示。
   */
  useSystemStore().removeTrayUnlock = electronApi.onTrayUnlock(() => {
    useWindowStore().toggleLock(false);
  });
  useWindowStore().removeWallpaperState = electronApi.onWallpaperState((enabled) => {
    useWindowStore().wallpaperEnabled = enabled;
  });

  /**
   * 壁纸模式不可用：把原因告诉用户
   *
   * 以前这种情况是**完全静默**的（主进程用空 catch 吞掉了原生模块加载失败），
   * 用户点了按钮什么都不发生，无从判断是环境不支持还是程序坏了。
   *
   * ⚠️ 主进程给的 `reason` 是**技术原因**（`找不到桌面壁纸层（WorkerW）`、
   * `SetParent 抛错: ...` 之类），**不能直接显示给用户** ——
   * 他看不懂，而且没必要把内部实现写在界面上。
   * 所以界面统一说一句人话，技术原因只进控制台日志（排查用）。
   */
  useWindowStore().removeWallpaperUnavailable = electronApi.onWallpaperUnavailable(
    (reason) => {
      console.warn('[wallpaper] 不可用（技术原因）：', reason);
      ElMessage.warning(
        '壁纸模式在当前系统上用不了。可以继续用窗口模式，功能不受影响。',
      );
    },
  );
  useWindowStore().initWallpaperState();
  useWindowStore().removeMaximizedListener = electronApi.onMaximized((val) => {
    useWindowStore().isMaximized = val;
  });
  useWindowStore().removeFullscreenListener = electronApi.onFullscreen((val) => {
    useWindowStore().isFullscreen = val;
  });
  // 声音输出设备变化时暂停（插拔耳机 / 切默认设备）
  useSystemStore().setupAudioDeviceWatch();
  // 片尾看门狗：常驻一个 1 秒的心跳（内部条件很严，平时几乎不做任何事）
  usePlaybackStore().startEndWatch();

  /**
   * 定时暂停：创建实例并订阅状态
   *
   * 放在这里（而不是 `created`）是因为它的 `readVideo` 回调要读 `<video>`，
   * 而那个元素要等模板挂载完才拿得到。定时器本身只有 `start()` 之后才
   * 开始 tick，所以在这里创建完全够用。
   */
  useSleepStore().setupSleepTimer();

  /**
   * 自绘托盘菜单打开期间，把窗口内的点击吞掉。
   *
   * 原因：壁纸模式开着鼠标转发，用户点菜单项时壁纸窗口**同时**会收到一次同坐标的
   * 合成点击，可能误触控制栏。用捕获阶段拦下来，菜单一关就恢复。
   */
  useSystemStore().removeTrayMenuListener = electronApi.onTrayMenuVisibility((visible) => {
    usePlaybackStore().trayMenuOpen = visible;

    /**
     * 刚弹出时先推一份最新状态
     *
     * 主进程手里那份是**上一次推送的快照**：暂停很久之后再右键托盘，
     * 定时倒计时会先用旧值显示一小会儿，等下一秒的推送才跳到正确值。
     * 菜单一出现就推一次，省掉这一下跳变（进度条也同理）。
     */
    if (visible) usePlaybackStore().syncTrayState();
  });

  /**
   * 这里原来有三个捕获阶段的监听，用来在托盘菜单打开时吞掉窗口内的点击 ——
   * 那是为了挡住「壁纸模式的鼠标转发把点菜单这一下同时合成到壁纸窗口」的副作用。
   * 现在壁纸模式已经 `forwardMouseInput: false`（界面也全隐藏了），不会再有合成点击，
   * 所以按计划注释掉。`trayMenuOpen` 本身还留着：菜单开着时要把进度推给菜单里的进度条。
   */
  // document.addEventListener('mousedown', useSystemStore().onTrayMenuGuard, true);
  // document.addEventListener('mouseup', useSystemStore().onTrayMenuGuard, true);
  // document.addEventListener('click', useSystemStore().onTrayMenuGuard, true);
  document.addEventListener('keydown', useWindowStore().handleKeydown);
  document.addEventListener('mousemove', useWindowStore().onDocMouseMove);
  document.addEventListener('mouseup', useWindowStore().onDocMouseUp);
  // 关闭窗口前记录一次播放信息（用户要求「关闭时」也记录）
  window.addEventListener('beforeunload', useSystemStore().onBeforeUnload);
  },




  /** 清理（原来是 `beforeUnmount` 的全部内容） */
  teardown(): void {
  const playback = usePlaybackStore();
  const sleep = useSleepStore();
  const system = useSystemStore();
  const session = useSessionStore();
  const win = useWindowStore();
  playback.stopDashSession();
  playback.stopBufferTicker();
  // 定时暂停：停掉 ticker 并退订（否则组件没了 interval 还在跑）
  sleep._sleepUnsub?.();
  sleep._sleepUnsub = null;
  sleep._sleepTimer?.dispose();
  sleep._sleepTimer = null;
  navigator.mediaDevices?.removeEventListener?.('devicechange', playback.onAudioDeviceChange);
  // 自绘托盘菜单的守卫与其他监听一起摘掉
  // （守卫本身已经注释掉，这里同样注释，留着对照）
  // document.removeEventListener('mousedown', system.onTrayMenuGuard, true);
  // document.removeEventListener('mouseup', system.onTrayMenuGuard, true);
  // document.removeEventListener('click', system.onTrayMenuGuard, true);
  system.removeTrayMenuListener?.();
  // 预热的隐藏流 / 元素也要收掉
  playback.clearAllWarm();
  for (const dir of ['next', 'prev'] as const) {
    const el = playback._warmEl[dir];
    if (el) {
      try {
        (el as unknown as HTMLVideoElement).remove();
      } catch {
        /* 忽略 */
      }
      playback._warmEl[dir] = null;
    }
  }
  if (playback._endWatchTimer) {
    clearInterval(playback._endWatchTimer);
    playback._endWatchTimer = null;
  }
  session.removeLoginListener?.();
  session.removeLogoutListener?.();
  system.removeTrayPlayControl?.();
  system.removeTrayPrev?.();
  system.removeTrayNext?.();
  system.removeTrayToggleMode?.();
  system.removeTraySeek?.();
  system.removeTrayVolume?.();
  system.removeTrayToggleMute?.();
  system.removeTrayShowPlaylist?.();
  system.removeTrayShowSleepTimer?.();
  system.removeTrayShowLogoutConfirm?.();
  system.removeTrayUnlock?.();
  win.removeWallpaperState?.();
  win.removeWallpaperUnavailable?.();
  win.removeMaximizedListener?.();
  win.removeFullscreenListener?.();
  document.removeEventListener('keydown', win.handleKeydown);
  document.removeEventListener('mousemove', win.onDocMouseMove);
  document.removeEventListener('mouseup', win.onDocMouseUp);
  window.removeEventListener('beforeunload', system.onBeforeUnload);
  this.clearSyncTimer();
    for (const stop of this._stopWatchers) stop();
    this._stopWatchers = [];
  },
};
