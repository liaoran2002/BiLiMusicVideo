import { defineStore } from 'pinia';
import { ElMessage } from 'element-plus';
import { toCacheKey } from '@common/types/playlist';
import type { PlaylistSong as StructuredSong } from '@common/types/playlist';
import type { ParsedVideoInfo } from '@common/types/ipc';
import type { BiliVideo } from '../types/app';
import electronApi from '../api/electron';
import { useUiStore } from './ui';
import type { AppData } from '../types/app';

/**
 * queue store
 *
 * 状态与动作都只属于这一个业务域；跨域访问通过 getter 拿到别的 store 实例。
 * 依赖方向见 ARCHITECTURE.md，不允许成环。
 */
export const useQueueStore = defineStore('queue', {
  state: (): Pick<
  AppData,
  'songs' | 'videoList' | 'videoListKeyword' | 'currentBvid' | 'randomList' | 'currentIndex' | 'currentVideoIndex' | 'MODE' | 'songName' | 'listName' | '_songToken'
> => ({

  songs: [],


  videoList: [],



  /**
   * `videoList` 属于哪一首歌（缓存键）
   *
   * `changeSong` 会立刻把 `songName` 切成新歌，但 `videoList` 要等搜索
   * 回来才换。用这个字段标明列表的归属，避免拿上一首的视频干新歌的事。
   */
  videoListKeyword: '',


  /** 正在播的视频 bvid（`currentVideoIndex` 可能是 -1，所以单独记一个） */
  currentBvid: '',


  randomList: [],


  currentIndex: 0,


  currentVideoIndex: 0,


  MODE: { read: 0, single: 1, random: 2 },


  songName: '',


  listName: '',


  _songToken: 0,
  }),
  getters: {
    uiStore: (): ReturnType<typeof useUiStore> => useUiStore(),


  /**
   * 当前这首歌收藏的 bvid 列表（视频列表里显示实心爱心）
   *
   * 直接从 `videoList` 读 `favorites` 字段：收藏状态的主进程那份是权威
   * （`videos.favorites`），而搜索返回的列表已经把它带上来了。
   * 以前是去歌单 store 里翻一份独立的收藏记录 —— 两份数据在「收藏后重排顺序」
   * 这类操作后必然对不上（界面上心是实的，位置却没动）。
   */
  favoriteBvids(): string[] {
    return this.videoList.filter((v) => v?.favorites).map((v) => v.bvid);
  },


  /** 当前播放歌曲的结构化信息（供详情弹窗右侧与 SMTC 使用） */
  currentSong(): StructuredSong | null {
    return this.songs[this.currentIndex] ?? null;
  },
  },
  actions: {



  /**
   * 重新搜索这首歌的候选视频
   *
   * `skipCache` 走主进程真实重搜（同时会与旧条目合并，保住已解析的播放地址）；
   * 不重播当前视频，只是把列表换了 —— 用户要的是「刷新列表」。
   */
  async refreshVideoList(): Promise<void> {
    const parts = this.getSongParts(this.currentIndex);
    /** 缓存键（`歌名-歌手`）—— 只用于给 `videoListKeyword` 打标识，不参与搜索 */
    const songName = this.songName;
    if (!parts || !songName) return;
    const token = this._songToken;
    try {
      const res = await this.uiStore.withNet(() => electronApi.searchSong(parts.song, parts.singer, true));
      if (token !== this._songToken) return;
      const videos = (res.data as { result?: BiliVideo[] } | null)?.result ?? [];
      this.videoList = videos;
      this.videoListKeyword = songName;
      // 当前播放的视频可能还在列表里（下标要跟着更新），也可能被搜没了
      this.currentVideoIndex = this.videoList.findIndex((v) => v.bvid === this.currentBvid);
      ElMessage.success(`已重新搜索《${songName}》，找到 ${this.videoList.length} 个视频`);
    } catch (err) {
      ElMessage.error(`重新搜索失败：${this.uiStore.errMsg(err)}`);
    }
  },




  /**
   * 收藏 / 取消收藏视频列表里的某一项
   *
   * 顺序完全交给主进程：收藏会把该条挪到第一位（`videos.ord`），
   * 取消收藏**位置不动**。所以这里不自己重排，只按返回值刷新
   * 「哪些是收藏」+ 把变动的那一条挪到本地列表最前面 ——
   * 如果自己重排，就会和库里的 ord 产生两套顺序。
   */
  async onToggleFavorite(bvid: string): Promise<void> {
    if (!bvid || !this.songName) return;
    const songName = this.songName;
    const isFav = this.favoriteBvids.includes(bvid);
    try {
      const { favorites } = await this.uiStore.withNet(() => electronApi.setFavorite(songName, bvid, !isFav));

      /**
       * 用返回值刷新收藏标记（而不是本地取反）：主进程可能因为
       * 「这条已经不在候选列表里」而新建一行，本地取反就与它不一致了。
       */
      const favSet = new Set(favorites);
      this.videoList = this.videoList.map((v) => ({
        ...v,
        favorites: favSet.has(v.bvid),
      }));

      if (!isFav) {

        /**
         * 收藏：把该条挪到 videoList 第一位
         *
         * 为什么不等下次搜索：用户点了爱心，界面**当场**就该看到它跳上去，
         * 否则会怀疑没生效。主进程那边同步也做了同样的挪动，两边一致。
         */
        const idx = this.videoList.findIndex((v) => v.bvid === bvid);
        if (idx > 0) {
          const [moved] = this.videoList.splice(idx, 1);
          this.videoList.unshift(moved);
        }
      }
      // 下标跟着列表走（挪动 / 顺序变化后必须重算，否则「正在播放」高亮会错位）
      this.currentVideoIndex = this.videoList.findIndex((v) => v.bvid === this.currentBvid);
    } catch (err) {
      ElMessage.error(`收藏操作失败：${this.uiStore.errMsg(err)}`);
    }
  },




  /** 「添加视频」确认：加进候选列表并收藏（收藏 = 排在最前面） */
  async onAddVideo(info: ParsedVideoInfo): Promise<void> {
    if (!this.songName) return;
    const songName = this.songName;
    if (!this.videoList.some((v) => v.bvid === info.bvid)) {
      this.videoList = [
        {
          bvid: info.bvid,
          title: info.title,
          pic: info.pic,
          author: info.author,
          duration: info.duration,
        },
        ...this.videoList,
      ];
    }
    try {

      /**
       * 走 `setFavorite` 而不是新增一个「加视频」接口：
       * 添加的语义就是「这首歌多一个我一定要用到的候选」，也就是收藏。
       * 主进程会在库里补插这一行（搜索没搜到的 bvid 本来不在 videos 表里），
       * 并把它挪到第一位 —— 与收藏完全同一条路径，不需要另写一套。
       */
      const { favorites } = await this.uiStore.withNet(() => electronApi.setFavorite(songName, info.bvid, true));
      const favSet = new Set(favorites);
      this.videoList = this.videoList.map((v) => ({
        ...v,
        favorites: favSet.has(v.bvid),
      }));
      const idx = this.videoList.findIndex((v) => v.bvid === info.bvid);
      if (idx > 0) {
        const [moved] = this.videoList.splice(idx, 1);
        this.videoList.unshift(moved);
      }
    } catch (err) {
      ElMessage.error(`添加视频失败：${this.uiStore.errMsg(err)}`);
      return;
    }
    this.currentVideoIndex = this.videoList.findIndex((v) => v.bvid === this.currentBvid);
    ElMessage.success(`已添加《${info.title || info.bvid}》`);
  },




  /**
   * 取第 index 首歌的**歌名 + 歌手**（分开给，供搜索用）
   *
   * ⚠️ 搜索接口收的是**两个字段**（`song` / `singer`），不是一个拼串 ——
   * 歌名本身可能含 `-`（`下坠Falling` / `R.` / `若是明仔载`），
   * 拼成 `歌名-歌手` 再拆会切错。歌单里本来就是分开存的，直接拿。
   *
   * @returns 歌名与歌手；**歌名为空时为 null**（不用空歌名去搜）
   */
  getSongParts(index: number): { song: string; singer: string } | null {
    const s = this.songs[index];
    if (!s || !s.name) return null;
    return { song: s.name, singer: s.singer ?? '' };
  },




  /**
   * 取第 index 首歌的**缓存键**（`"歌名-歌手"`）
   *
   * ⚠️ 这是**缓存键**（`videos.search_key` / `song_meta.search_key` 的值），
   * 也是判断「这份视频列表属于哪首歌」的标识 —— **不能用于搜索**
   * （搜索走 `getSongParts`，要分开的歌名/歌手）。
   *
   * 名字里的 `Name` 是历史遗留（早先只有歌名），它装的是「歌名 + 歌手」。
   */
  getSongName(index: number): string | null {
    if (!this.songs || this.songs.length === 0) return null;
    const song = this.songs[index];
    return song ? toCacheKey(song) : null;
  },




  /** 取第 index 首歌的结构化信息（供界面展示封面/专辑） */
  getSong(index: number): StructuredSong | null {
    return this.songs[index] ?? null;
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
});
