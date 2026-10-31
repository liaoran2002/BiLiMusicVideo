import { defineStore } from 'pinia';
import { ElMessage } from 'element-plus';
import { QUALITY_COOLDOWN_MS, NET_BUSY_HINT_MS } from './constants';
import type { ListType } from '../types/app';
import type { AppData } from '../types/app';

/**
 * ui store
 *
 * 状态与动作都只属于这一个业务域；跨域访问通过 getter 拿到别的 store 实例。
 * 依赖方向见 ARCHITECTURE.md，不允许成环。
 */
export const useUiStore = defineStore('ui', {
  state: (): Pick<
  AppData,
  'listType' | 'playlistManagerVisible' | 'settingsVisible' | 'aboutVisible' | 'addVideoVisible' | 'sleepPanelVisible' | '_netBusyCount' | '_qualityCooldownUntil' | '_qualityCooldownTimer' | '_lastNetBusyHintAt'
> => ({

  listType: 'none',


  /** 歌单管理弹窗（新建/编辑/同步/曲目浏览都在里面） */
  playlistManagerVisible: false,


  /** 设置弹窗 */
  settingsVisible: false,


  /** 关于弹窗 */
  aboutVisible: false,


  /** 「添加视频」弹窗（视频列表右上角的加号） */
  addVideoVisible: false,


  /** 定时暂停面板是否展开 */
  sleepPanelVisible: false,



  /**
   * ★ **当前有几个网络请求在飞**（搜索 / 解析播放地址）
   *
   * 用于把控制栏里**会再发请求**的控件禁掉（切歌、清晰度/音质切换）——
   * 用户狂点切歌会让请求成倍打出去，B站直接 412 风控。
   *
   * 用**计数器**而不是布尔：搜索和解析会并发（切歌时先搜索、再解析地址），
   * 布尔会被先结束的那个提前清掉，于是「解析还没完」时按钮已经解禁了。
   */
  _netBusyCount: 0,



  /**
   * ★ **清晰度 / 音质切换后的冷却截止时间戳**（毫秒）
   *
   * 切换清晰度会 `changeVideo(skipCache: true)` **重新解析地址**（发请求），
   * 所以它本来就被 `_netBusyCount` 盖住。但那个计数在请求结束时立刻归零，
   * 用户马上又能点下一次 —— 连点几下就是连着几个重新解析请求。
   *
   * 所以额外加一道**固定 3 秒冷却**：改完清晰度/音质的 3 秒内，
   * 那两个下拉保持禁用（`0` = 没有冷却）。
   */
  _qualityCooldownUntil: 0,


  /** 上面那个冷却的定时器句柄（重复调用时先清掉旧的，避免堆定时器） */
  _qualityCooldownTimer: null as ReturnType<typeof setTimeout> | null,



  /**
   * 上次提示「正在加载，先别点」的时间戳（毫秒）
   *
   * 用于给 `notifyNetBusy()` 节流 —— 连点时别让 toast 刷屏。
   */
  _lastNetBusyHintAt: 0,
  }),
  getters: {

  /*
   * `tagBonusConfig`（关键词加权表）也已搬走 —— 它唯一的用途是喂给
   * `tagBonus()` 打分，而打分现在在主进程（`@common/utils/videoRank`，
   * 直接读主进程的设置）。渲染层不再需要这份配置。
   */

  /**
   * ★ **有网络请求在飞**（传给控制栏禁用「会发请求」的控件）
   *
   * 见 `_netBusyCount` 的注释。这里只做 `> 0` 的转换，
   * 真正的加减在 `beginNet()` / `endNet()` 里。
   *
   * ⚠️ 它**不含**清晰度冷却 —— 那个单独由 `qualityBusy` 表达，
   * 因为「切歌按钮」没必要因为「刚改过清晰度」被禁 3 秒。
   */
  netBusy(): boolean {
    return this._netBusyCount > 0;
  },



  /**
   * ★ **清晰度 / 音质下拉是否该禁用**
   *
   * 两个来源任一成立就禁：
   *  - `netBusy`：正在解析地址（切换本来就要重新解析，等它做完）；
   *  - **固定 3 秒冷却**：`_qualityCooldownUntil` 还没到
   *    （改动完成后 3 秒内不许再改，防止连点打出一串解析请求）。
   *
   * ⚠️ 冷却**到点时有 `setTimeout` 把它清成 0**（见 `startQualityCooldown`）——
   * 光靠「现在时间 < 截止时间」这个比较，时间流逝本身不会触发重渲染，
   * 3 秒后界面会一直卡在禁用状态。
   */
  qualityBusy(): boolean {
    return this.netBusy || Date.now() < this._qualityCooldownUntil;
  },
  },
  actions: {



  showList(event: ListType): void {
    this.listType = this.listType == event ? 'none' : event;
  },




  /**
   * 有没有弹窗开着
   *
   * 弹窗是模态的（遮罩挡住整窗），这时按 S 锁定会在弹窗底下藏界面，
   * 所以快捷键在这种情况下直接不响应 —— 锁定按钮本来也点不到。
   */
  anyDialogOpen(): boolean {
    return (
      this.listType !== 'none' ||
      this.playlistManagerVisible ||
      this.settingsVisible ||
      this.aboutVisible ||
      this.addVideoVisible
    );
  },



  /**
   * ★ 标记「开始一个网络请求」（会让控制栏里发请求的控件禁用）
   *
   * ## 为什么必须配对使用
   *
   * `beginNet()` / `endNet()` 用**计数器**而不是布尔：
   * 切歌时「搜索 → 解析地址」是两段连续的请求，中间还可能并发别的。
   * 用布尔会被先结束的那个提前清掉，于是「解析还没完」时按钮已经解禁，
   * 用户又能点下一首 —— 正是我们要拦掉的场景。
   *
   * ## 用法（务必 try/finally）
   *
   * ```ts
   * this.beginNet()
   * try { await electronApi.searchSong(...) } finally { this.endNet() }
   * ```
   *
   * `finally` 是必须的：请求抛错时如果不减，计数器永远 > 0，
   * **控制栏会一直禁着**（比风控还糟）。所以下面所有调用点都写成
   * `try/finally` 而不是「成功后 endNet」。
   */
  beginNet(): void {
    this._netBusyCount += 1;
  },




  /** 标记「一个网络请求结束」（配对 `beginNet`，必须在 finally 里调） */
  endNet(): void {
    this._netBusyCount = Math.max(0, this._netBusyCount - 1);
  },




  /**
   * ★ 包住一个**会发网络请求**的调用：期间禁用控制栏里发请求的控件
   *
   * ```ts
   * const res = await this.withNet(() => electronApi.searchSong(song, singer))
   * ```
   *
   * 为什么不每处手写 `try/finally`：调用点有近十个，漏一个 `endNet`
   * 就会让**控制栏永久禁着**（比风控还糟）。收成一个包装器，
   * 所有调用点写法一致，`finally` 只在这一个地方出现。
   *
   * 泛型保留原返回值类型（`electronApi` 那些方法的返回值形状不变）。
   */
  async withNet<T>(fn: () => Promise<T>): Promise<T> {
    this.beginNet();
    try {
      return await fn();
    } finally {
      this.endNet();
    }
  },




  /**
   * ★ 启动「清晰度 / 音质」改完后的**3 秒冷却**
   *
   * 期间那两个下拉保持禁用，防止连点 —— 每点一次都会
   * `changeVideo(skipCache: true)` 重新解析地址，连点就是连着几个请求。
   *
   * ## 为什么用 `setTimeout` 清标记，而不是每次渲染时算
   *
   * 光判「`Date.now() < 截止时间`」的话，时间流逝**不会触发 Vue 重渲染** ——
   * 3 秒后界面会一直停在禁用状态，直到别的原因让它重渲染一次。
   * `setTimeout` 到点把标记清成 0，那个赋值本身就会触发重渲染，界面自然解锁。
   *
   * 重复调用是安全的：前一个定时器会被记下来并清掉（`_qualityCooldownTimer`），
   * 所以不会堆一串定时器。
   */
  startQualityCooldown(): void {
    this._qualityCooldownUntil = Date.now() + QUALITY_COOLDOWN_MS;
    if (this._qualityCooldownTimer !== null) clearTimeout(this._qualityCooldownTimer);
    this._qualityCooldownTimer = setTimeout(() => {
      this._qualityCooldownTimer = null;
      this._qualityCooldownUntil = 0;
    }, QUALITY_COOLDOWN_MS);
  },




  /**
   * 统一把 unknown 类型的 catch 错误转成**可读文案**
   *
   * ## ⚠️ 这里是「所有错误显示给用户」的**收口**，所以要做一道过滤
   *
   * 主进程抛的 message 多半是人话（我们各处都在注意措辞），但**不能假设**：
   * 将来任何一处 `throw new Error('HTTP 500')` / 接口原文透传，都会经这里
   * 显示到界面上 —— 用户看不懂，而且可能把内部实现写进截图里。
   *
   * 所以这里做一次**兜底替换**：认出「明显是技术文案」的就换成通用人话，
   * 原文只进控制台。判定故意写得宽松（宁可多换一次，也别漏出去）。
   */
  errMsg(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err ?? '');

    /**
     * 技术文案的特征：状态码 / 全大写错误码 / 常见内部术语。
     * 命中就替换成通用文案（真实内容打进控制台，排查不受影响）。
     */
    const looksTechnical =
      /^(HTTP|ERR_|NAV_FAILED|AUTH_FAILED)/.test(raw) ||
      /SourceBuffer|MediaSource|SetParent|WorkerW|fnval|wbi|SourceBuffer/i.test(raw) ||
      /\b(4\d{2}|5\d{2})\b/.test(raw);
    if (looksTechnical) {
      console.warn('[ui] 错误文案含技术细节，已替换为通用提示。原文：', raw);
      return '操作失败，请稍后再试';
    }
    return raw;
  },




  /**
   * 这个错误是不是「操作太频繁，暂时搜不到」
   *
   * ## 为什么只能按 message 判断（不能按类型）
   *
   * 主进程抛的 `RateLimitError` 经 IPC 传过来**只剩 message**
   * （Error 被序列化，`name` / 原型链 / 自定义字段全丢），
   * 所以渲染层拿不到那个类 —— 只能比 message。
   *
   * ## 为什么匹配的是一句**中性文案**
   *
   * 匹配 **主进程那份固定的中性文案**（`RATE_LIMIT_MESSAGE`）——
   * 它同时也是用户可能看到的那句，所以不能写「风控」「412」这类词
   * （用户会截图）。两边用**同一句话**比对，既准确又不带敏感信息。
   *
   * ⚠️ 改主进程那句文案时，这里要同步改 —— 所以两边都留了注释互相指向。
   */
  isRateLimitErr(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return msg.includes('暂时搜不到结果');
  },




  /**
   * ★ 提示「正在加载，先别点」——**必须给反馈**，否则用户以为按钮坏了
   *
   * 请求在飞的时候，控制栏的切歌按钮被灰掉、托盘/媒体键被忽略。
   * 但「点了没反应」和「按钮坏了」在用户看来是一样的 —— 所以补一条提示。
   *
   * 用 `$message`（顶部一闪而过的 toast）而不是 `$notify`（右上角浮层）：
   *  - 这事**不需要用户做什么**，只是告诉他「等一下，不是坏了」；
   *  - 而且它可能被连续触发（用户连点），浮层会叠一屏 —— toast 只有一条。
   *
   * 加**节流**（`NET_BUSY_HINT_MS`）：连点时别刷屏。
   */
  notifyNetBusy(): void {
    const now = Date.now();
    if (now - this._lastNetBusyHintAt < NET_BUSY_HINT_MS) return;
    this._lastNetBusyHintAt = now;

    /**
     * ⚠️ 文案**不提技术细节**（别说「限流」「请求被拦」）——
     * 用户会截图。只说「在加载、等一下」就够，这也是他需要知道的全部。
     */
    ElMessage.info('正在加载中，请稍候……');
  },
  },
});
