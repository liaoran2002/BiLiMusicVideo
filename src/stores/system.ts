import { defineStore } from 'pinia';
import type { AppSetting } from '@common/types/app_setting';
import { usePlaybackStore } from './playback';
import { useQueueStore } from './queue';
import { useSettingStore } from './setting';
import { usePlaylistStore } from './playlists';
import type { AppData } from '../types/app';

/**
 * system store
 *
 * 状态与动作都只属于这一个业务域；跨域访问通过 getter 拿到别的 store 实例。
 * 依赖方向见 ARCHITECTURE.md，不允许成环。
 */
export const useSystemStore = defineStore('system', {
  state: (): Pick<
  AppData,
  'removeTrayPlayControl' | 'removeTrayPrev' | 'removeTrayNext' | 'removeTrayToggleMode' | 'removeTrayShowPlaylist' | 'removeTrayShowSleepTimer' | 'removeTrayShowLogoutConfirm' | 'removeTrayUnlock' | 'removeTraySeek' | 'removeTrayVolume' | 'removeTrayToggleMute' | 'removeTrayMenuListener'
> => ({

  removeTrayPlayControl: null,


  removeTrayPrev: null,


  removeTrayNext: null,


  removeTrayToggleMode: null,


  removeTrayShowPlaylist: null,


  removeTrayShowSleepTimer: null,


  removeTrayShowLogoutConfirm: null,


  /** 左键点托盘图标 -> 解锁 */
  removeTrayUnlock: null as null | (() => void),


  removeTraySeek: null,


  removeTrayVolume: null,


  removeTrayToggleMute: null,


  removeTrayMenuListener: null,
  }),
  getters: {
    playbackStore: (): ReturnType<typeof usePlaybackStore> => usePlaybackStore(),
    queueStore: (): ReturnType<typeof useQueueStore> => useQueueStore(),
    settingStore: (): ReturnType<typeof useSettingStore> => useSettingStore(),
    playlistsStore: (): ReturnType<typeof usePlaylistStore> => usePlaylistStore(),
  },
  actions: {



  /** 注册系统媒体键的处理（播放/暂停/上下曲） */
  setupMediaSessionActions(): void {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => { if (this.playbackStore.paused) this.playbackStore.playControl(); }],
      ['pause', () => { if (!this.playbackStore.paused) this.playbackStore.playControl(); }],
      ['nexttrack', () => this.playbackStore.next()],
      ['previoustrack', () => this.playbackStore.prev()],
      ['seekbackward', () => this.playbackStore.changeTime(Math.max(0, this.playbackStore.currentTime - 10))],
      ['seekforward', () => this.playbackStore.changeTime(Math.min(this.playbackStore.duration || 0, this.playbackStore.currentTime + 10))],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* 个别 action 不支持时跳过 */
      }
    }
  },




  setupAudioDeviceWatch(): void {
    const md = navigator.mediaDevices;
    if (!md || typeof md.addEventListener !== 'function') return;
    md.addEventListener('devicechange', this.playbackStore.onAudioDeviceChange);
  },




  /**
   * 关闭窗口前记录播放信息
   *
   * beforeunload 里不能等异步，所以这里直接发一次 fire-and-forget 的 IPC；
   * 主进程侧有 300ms 防抖并在 before-quit 里 flush，能保证落盘。
   */
  onBeforeUnload(): void {
    const patch: Partial<AppSetting> = {
      'player.resumeTime': Math.floor(this.playbackStore.currentTime || 0),
    };
    this.settingStore.update(patch);
    this.playlistsStore.setLastIndex(this.queueStore.currentIndex);

    /**
     * 退出时**不需要**再写 `selectedBvid`
     *
     * 它已经在每次切视频时落库了（见 `changeVideo` / `api:resolveVideo`），
     * 这里再写一次是重复的。而且 `beforeunload` 是同步的、Electron 不会等 promise，
     * 真要写还得依赖 `ipcRenderer.invoke` 的同步投递，属于把正确性押在一个
     * 不好验证的行为上 —— 没必要，那条数据早就是最新的了。
     */
  },




  /**
   * 自绘托盘菜单打开期间吞掉窗口内的鼠标点击（捕获阶段）
   *
   * 壁纸模式的鼠标转发会把「点菜单项」这一下同时合成到壁纸窗口上，
   * 不拦的话可能顺手把控制栏的按钮也点了一次。
   */
  onTrayMenuGuard(e: MouseEvent): void {
    if (!this.playbackStore.trayMenuOpen) return;
    e.stopPropagation();
    e.preventDefault();
  },
  },
});
