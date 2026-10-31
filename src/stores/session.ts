import { defineStore } from 'pinia';
import { ElMessage, ElMessageBox } from 'element-plus';
import electronApi from '../api/electron';
import { useUiStore } from './ui';
import { useQueueStore } from './queue';
import { usePlaybackStore } from './playback';
import type { AppData } from '../types/app';

/**
 * session store
 *
 * 状态与动作都只属于这一个业务域；跨域访问通过 getter 拿到别的 store 实例。
 * 依赖方向见 ARCHITECTURE.md，不允许成环。
 */
export const useSessionStore = defineStore('session', {
  state: (): Pick<
  AppData,
  'isLoggedIn' | 'userFace' | 'userName' | 'removeLoginListener' | 'removeLogoutListener'
> => ({

  isLoggedIn: false,


  userFace: '',


  userName: '',


  removeLoginListener: null,


  removeLogoutListener: null,
  }),
  getters: {
    uiStore: (): ReturnType<typeof useUiStore> => useUiStore(),
    queueStore: (): ReturnType<typeof useQueueStore> => useQueueStore(),
    playbackStore: (): ReturnType<typeof usePlaybackStore> => usePlaybackStore(),
  },
  actions: {



  async loadUserInfo(): Promise<void> {
    try {
      const info = await electronApi.getUserInfo();
      this.userFace = info.face;
      this.userName = info.name;
      this.isLoggedIn = true;
      electronApi.setLoggedIn(true);
    } catch (err) {

      /**
       * 拉取失败 ≠ 没登录
       *
       * 主进程把两者分开了：`未登录` 是 nav 明确说的，`NAV_FAILED` 是这次请求没问到。
       * 后者（网络抖动、风控）不能把界面切成未登录 —— 否则托盘菜单会显示「登录」、
       * 解析视频还会按未登录档位取流并写进缓存，表现就是「明明登录着却每次都重新解析」。
       */
      if (this.uiStore.errMsg(err) === 'NAV_FAILED') {
        console.warn('[auth] 登录态查询失败（网络问题），保持原状态');
        return;
      }
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
    const bvid = this.queueStore.currentBvid;
    if (!bvid) return;
    // 重新解析会换 URL，视频会重新加载，先把进度记下来
    const resumeAt = this.playbackStore.currentTime;
    if (resumeAt > 3) {
      this.playbackStore.seekAfterLoad = resumeAt;
      this.playbackStore.seekAfterLoadFor = this.queueStore.songName;
    }
    ElMessage.success('登录成功，正在用更高清晰度重新加载当前视频');
    await this.playbackStore.changeVideo(bvid, this.queueStore.videoListKeyword || this.queueStore.songName, { skipCache: true });
  },




  handleLogoutConfirm(): void {
    if (!this.isLoggedIn) {
      this.startLogin();
      return;
    }
    ElMessageBox.confirm('确定要退出登录吗?', '提示', {
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




  async startLogin(): Promise<void> {
    await electronApi.startLogin();
  },
  },
});
