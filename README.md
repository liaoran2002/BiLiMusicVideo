# BLMV - B站音乐视频桌面端

基于 Electron + Vue 3 构建的 B站音乐视频播放器，支持歌单自动播放和桌面壁纸模式。

## 功能特性

- **歌单曲目浏览**：点左上角任意歌单即可打开曲目详情——每首显示**封面 / 歌名 / 歌手 / 专辑 / 时长**，支持按歌名·歌手·专辑搜索，右侧显示当前播放的大封面
- **系统媒体控件（Windows SMTC）**：歌曲信息与**封面**会同步到系统的媒体弹窗/锁屏/音量浮层，键盘媒体键（播放/暂停/上下曲/快进快退）可直接控制
- **多歌单管理**：支持建多个歌单，左上角一键切换；歌单可编辑、删除，各自记住自己的播放位置
- **自动同步**：歌单可设「每次启动同步」或「定时同步」，也可随时手动「全部同步」
- **自动续播**：记录歌单 / 歌曲 / 视频 / 播放进度，下次打开自动回到上次的位置继续播放
- **多平台歌单导入**：直接粘贴 **网易云音乐 / QQ音乐 / 酷我音乐** 的歌单分享链接，自动识别平台并解析出完整曲目（移植自 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) 的 `musicSdk`，纯本地解析，不依赖任何第三方聚合服务）
- **歌单播放**：解析出的曲目自动在 B站 搜索并播放匹配视频
- **智能匹配**：根据歌名、歌手名对搜索结果打分排序，优先选择官方/MV/高清版本；选定过的视频会被记住，续播时精确还原同一个视频
- **播放模式**：列表循环、单曲循环、随机播放
- **桌面壁纸**：一键将播放器嵌入桌面壁纸（基于 `electron-as-wallpaper`）
- **系统托盘**：最小化后通过托盘控制播放、切歌、切换模式
- **账号登录**：支持 B站 账号登录，获取高清视频资源
- **快捷键**：
  - `空格` 播放/暂停
  - `↑↓` 调节音量
  - `←→` 调节进度（5秒）
  - `F` 全屏
  - `Esc` 退出全屏
- **毛玻璃 UI**：现代化半透明界面，自定义无边框标题栏
- **视频缓存**：搜索结果和视频地址本地缓存，减少重复请求
- **自动恢复**：Cookie 持久化存储，重启无需重新登录

## 技术栈

- [Electron](https://www.electronjs.org/) 42
- [Vue 3](https://vuejs.org/) 3.5 + [TypeScript](https://www.typescriptlang.org/) 5.9
- [electron-vite](https://electron-vite.org/) 6（主进程 / preload / 渲染进程三端统一构建）
- [Pinia](https://pinia.vuejs.org/) 3（渲染进程响应式副本，**不负责持久化**）
- [Element Plus](https://element-plus.org/) 2.14
- [electron-as-wallpaper](https://github.com/nicehash/electron-as-wallpaper) 2.0

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（electron-vite 会同时起渲染进程 HMR 与 Electron）
npm run dev

# 壁纸模式开发（启动后直接嵌入桌面）
npm run dev:wall

# 类型检查（主进程 + 渲染进程）
npm run typecheck

# 构建产物到 out/
npm run build

# 打包（NSIS 安装包 + 便携版）
npm run dist
```

## 架构设计

整体参照 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) 的核心思想：
**主 / 渲染共用一套类型，配置由主进程唯一持有，渲染进程只做响应式副本。**

### 目录结构

```
├── electron/
│   ├── common/                     # ★ 主进程与渲染进程共用（LX 的 src/common）
│   │   ├── types/
│   │   │   ├── app_setting.ts      #   AppSetting 全量配置 TS 接口（扁平点号键）
│   │   │   ├── ipc.ts              #   IPC 频道契约 ChannelMap（入参/返回值）
│   │   │   └── api.ts              #   preload 暴露给 window 的 api 契约
│   │   ├── defaultSetting.ts       #   默认配置对象（satisfies 强校验）
│   │   ├── constants.ts            #   配置版本号、存储名等常量
│   │   ├── ipcNames.ts             #   频道名集中定义
│   │   ├── mainIpc.ts              #   主进程侧类型化 IPC 包装 + 广播
│   │   ├── rendererIpc.ts          #   渲染进程（preload）侧类型化 IPC 包装
│   │   └── utils/
│   │       ├── migrateSetting.ts   #   配置版本迁移（版本闸门逐级抬升）
│   │       ├── mergeSetting.ts     #   默认值 + 用户值合并，并算出变化的 key
│   │       └── common.ts           #   compareVer / debounce
│   ├── main/
│   │   ├── index.ts                # 入口：便携模式 → 初始化配置/歌单 → 注册 IPC → 建窗口
│   │   ├── portable.ts             # 便携模式（exe 同级 portable 目录）
│   │   ├── biliApi.ts              # B站 API（搜索/视频解析/WBI 签名）
│   │   ├── wallpaperDetect.ts      # WorkerW 层检测（可选依赖，惰性加载）
│   │   ├── music/                  # ★ 多平台歌单解析（移植自 LX 的 musicSdk）
│   │   │   ├── index.ts            #   音源总表 + 按链接自动识别平台
│   │   │   ├── http.ts             #   请求层（跟随重定向 / 超时 / 解压）
│   │   │   ├── utils.ts            #   时长格式化、HTML 实体解码、歌手名拼接
│   │   │   └── sources/
│   │   │       ├── wy.ts           #   网易云（weapi 加密通道）
│   │   │       ├── wyCrypto.ts     #   网易云 weapi / linuxapi 加密
│   │   │       ├── tx.ts           #   QQ音乐（musicu.fcg）
│   │   │       └── kw.ts           #   酷我音乐（pl.svc）
│   │   ├── utils/
│   │   │   ├── setting.ts          # ★ 配置服务：内存常驻 + 防抖落盘 + 变更通知
│   │   │   ├── playlist.ts         # ★ 歌单集合服务：迁移 / 增删改 / 同步
│   │   │   ├── store.ts            # 原子写入的 JSON 存储
│   │   │   └── cache.ts            # 搜索缓存
│   │   └── ipc/                    # 按领域拆分的 IPC handler
│   ├── preload/
│   │   ├── index.ts                # contextBridge 暴露类型化 api
│   │   └── index.d.ts              # window.electronAPI 全局声明
│   └── types/koffi.d.ts
├── src/                            # 渲染进程
│   ├── main.ts                     # 挂载前先拉配置 + 挂广播监听
│   ├── App.vue
│   ├── stores/
│   │   ├── setting.ts              # ★ Pinia：配置的响应式副本
│   │   └── playlists.ts            # ★ Pinia：歌单集合 + 同步编排
│   ├── api/electron.ts             # 直接透出 window.electronAPI（已带类型）
│   ├── types/app.ts                # 组件数据类型
│   └── components/
│       ├── PlaylistPanel.vue       # ★ 左上歌单入口（下拉面板）
│       ├── PlaylistDetail.vue      # ★ 歌单曲目详情（封面/专辑/歌手 + 搜索）
│       ├── PlaylistManager.vue     #   管理歌单弹窗
│       ├── PlaylistEditor.vue      #   新建 / 编辑歌单弹窗
│       ├── SettingsDialog.vue      # ★ 设置弹窗
│       ├── biliVideoControls.vue   #   播放控制栏
│       └── showList.vue            #   歌曲/视频列表弹窗（含封面/专辑/歌手）
└── electron.vite.config.ts
```

### 配置（setting）数据流

配置**由主进程唯一持有**，渲染进程的 Pinia 只是一份副本：

```
主进程启动
  └─ portable.ts      判断便携模式，改写 app.getPath('userData')
  └─ initSetting()    读 setting.json → migrateSetting 版本迁移
                      → mergeSetting 与 defaultSetting 合并补全缺项
  └─ 内存常驻一份完整配置，写入磁盘走 300ms 防抖

渲染进程
  页面加载   api.getSetting()             → 填充 Pinia
  用户改表单 api.updateSetting(partial)   → 主进程合并/落盘
  主进程广播 'setting:update'（只含变化的 key）→ 所有窗口的 Pinia 自动同步
```

关键设计点：

1. **扁平点号键**（`'player.volume'`、`'common.wallpaperMode'`）
   与 LX 一致。好处是「默认值 ↔ 用户值」只需一层浅合并，
   并且能精确算出到底哪些 key 变了 —— 广播和写盘都只处理变化的部分。
2. **只接收 `Partial<AppSetting>` 局部更新**，避免整包配置来回传。
3. **Pinia 不持久化**：更新后不要自己赋值，统一等主进程广播回来，
   保证单一数据源，也天然支持多窗口同步。

### TypeScript 类型链路

```
electron/common/types/ipc.ts  IpcChannelMap（频道 → 入参/返回值）
        │
        ├─ electron/main/ipc/*        mainHandle('setting:update', params => …)  ← 参数自动有类型
        │
        └─ electron/preload/index.ts  rendererInvoke/rendererOn 自动推导
                 │  satisfies RendererAPI（契约校验，漏实现会编译报错）
                 └─ src/global.d.ts 扩展 window
                        └─ src/api/electron.ts → 组件里 window.electronAPI.xxx 全量提示
```

### 别名的配置（容易踩坑）

`@common/*` 被三端共用，因此别名必须在**两处同时配置**：

- `electron.vite.config.ts` 的 `main` / `preload` / `renderer` 三个 `resolve.alias`（给构建器用）
- `tsconfig.node.json` / `tsconfig.web.json` 的 `paths`（给 tsc / IDE 用）

只配一处会出现「构建能过但编辑器报红」或反之。

### 界面布局

标题栏只保留必要入口，避免按钮堆积：

```
┌──────────────────────────────────────────────────────────────────┐
│ [☰ 歌单 ▾] │      拖拽区 / 歌曲名        │ [壁纸] [头像] [设置] [—][□][×] │
└──────────────────────────────────────────────────────────────────┘
```

- **左上「歌单」**：点开是歌单列表（切换 / 立即同步 / 新建 / 全部同步 / 管理歌单）。
  原来的「设置歌单」按钮已并入这里，不再单独占位。
- **右上「设置」**：紧挨头像右侧，打开设置弹窗。只放**需要用户决策且没有其它入口**的项：
  - 播放：自动续播、恢复播放进度
  - 通用：启动进入壁纸模式、清除缓存、恢复默认

**不在设置里重复出现的项**（避免两处状态打架）：

| 项 | 在哪里改 |
| --- | --- |
| 循环模式、音量 | 底部播放控制栏，改完自动记录、下次启动自动恢复 |
| 歌单同步策略 | 每个歌单自己的「新建 / 编辑」弹窗里（手动 / 启动时 / 定时 + 间隔） |

歌单同步策略挂在歌单上而不是全局，是为了避免「明明给歌单设了自动同步，却被全局开关关掉」这种困惑。
应用启动时会按各歌单自己的策略同步；定时同步按所有定时歌单里**最小的间隔做心跳**，每次心跳只同步真正到点的歌单，所以各歌单周期可以不同而只需一个定时器。

底部的播放控制栏（播放、进度、音量、循环模式）由 `biliVideoControls` 负责，鼠标移上去才显现。
信息区两行：上行是 B 站视频标题，下行是 `歌曲名 - 歌手 · 专辑`，
**行尾是清晰度和音质两个角标，点开即可切换**。

### 清晰度 / 音质切换

这两处**不是一回事**，别把它们做成同一份数据：

| 在哪 | 作用 | 选项从哪来 | 是否持久 |
| --- | --- | --- | --- |
| 设置 → 播放 | **自动播放时遵守的上限**（"最多播到哪一档"） | **完整档位表**（12 档清晰度 / 3 档音质） | 是（`setting.json`） |
| 控制栏角标菜单 | 针对**当前这一首**临时切换 | **playurl 响应里真正能拿到的档位** | 否，只作用于本次会话 |

所以设置页就该铺全表 —— 它是「你愿意播到多高」，和音量 / 循环模式那种「当前值」性质不同；
能不能拿到是平台按登录态 / 会员等级 / 视频可用档位决定的事，不该拿它来限制你选什么。
而角标菜单列的是「这个视频此刻能选什么」，自然只列 playurl 给得出的，
并且**不受上限约束**（手动切换是用户明确要求，设了上限也照样能选上去）。

上限具体生效在两处：`pickDashVideo` 挑「不超过上限里最高的一条」，
`pickDashAudio` 优先 id 精确匹配、否则挑带宽不超过它且最大的那条
（所以选了 64K 不会因为响应里没有 30216 就悄悄给成 192K）。

菜单里档位的取值优先级：

1. 有 dash → 用 `dash.video[]` / `dash.audio[]` 的 `id`（这才是实际能播的流）；
2. 没有 dash（durl 兜底）→ 才退回 `accept_quality`；
3. 展示名一律取 `support_formats` 的 `display_desc` / `new_description`，取不到才用内置档位表兜底。

> 菜单里为什么不铺静态全表：`accept_quality` 只说明**账号有权限**，不代表这条链路给得了
> —— 实测它列出 1080P，durl 通道却只回 720P。列一堆选不了的档位只会误导。

实现上切换就是**带 `qn` / `audioId` 重新解析一次**（`skipCache: true`），
解析前后把播放进度记到 `seekAfterLoad` 里，切完接着播。

**必须把 `qn` / `audioId` 一路传到 `resolveVideoUrl`**：主进程里算出 `wantQn` / `wantAudioId`
却只喂给「读缓存」那一步、忘了传给真正的解析调用，会让它悄悄用回默认值
（这个坑实际踩过：菜单点了没反应，因为解析始终用默认的 30280）。

### 清晰度角标：数据从哪来（踩坑记录）

角标内容取自 **playurl 响应的 `quality` 字段**（`electron/main/utils/quality.ts`），
再用 `support_formats` 里的 `display_desc` / `new_description` 取展示名 ——
那正是 B 站自己播放器显示的文字，能区分「1080P 高清 / 1080P 60帧 / 1080P 高码率」这些同分辨率档位。
dash 链路取「地址和实际播放地址一致」的那条流的 `id`，durl 链路取顶层 `data.quality`。

**不要用请求参数里的 `qn`，但也不要用分辨率硬推。** 实测（`qn` 是请求参数）：

| 请求 `qn` | 响应 `quality` | `accept_quality` | 实际解码 |
| --- | --- | --- | --- |
| 64 | 64（720P） | `[64, 16]` | 1280×720 |
| 64 | 64（720P） | `[116, 80, 64, 16]` | 1280×720 / 720×1280（竖屏） |
| **120** | **64（720P）** | `[116, 80, 64, 16]` | 1280×720 |

最后一行是关键：请求 4K 也回 720P，说明 `quality` **如实报告平台降级后的实际档位**，不是回显请求参数。
而按分辨率反推会在两种情况下出错 —— 竖屏（720×1280）和裁掉黑边的宽银幕（1280×533、960×720）——
所以分辨率只作为**兜底**（`src/utils/videoQuality.ts`）和悬浮提示里的交叉印证。

> **播放清晰度的天花板在 dash 上，不在 `qn` 上。**
> `fnval: 1`（渐进式 mp4 / durl）通道**无论 `qn` 填多少、无论是否登录，都封顶 720P**；
> 1080P / 4K 只存在于 dash 通道，而 dash 的音视频是**两条独立的流**。
> 实测（同一视频、已登录）：

| 请求 | 响应 `quality` | 拿到的东西 |
| --- | --- | --- |
| `platform=html5` + `fnval=1` + `qn=116` | 64（720P） | durl mp4，1280×720 |
| 去掉 html5 + `fnval=1` + `qn=80` | 64（720P） | durl mp4，1280×720 |
| 去掉 html5 + `fnval=1` + `qn=116` | 64（720P） | durl mp4，1280×720 |
| 去掉 html5 + `fnval=1` + `qn=120` | 64（720P） | durl mp4，1280×720 |
| 去掉 html5 + **`fnval=16`** + `qn=116` | **80（1080P）** | **dash：`80(1920x1080)` + 独立音轨 `30280`** |

所以现在 `resolveVideoUrl` 是 **dash 优先、durl 兜底**：
拿到 dash 双轨就交给渲染层用 MSE 合成；dash 不可用（或渲染层播放失败）才退回 durl 720P。

平台偶尔会出现「报 720P、帧却是 1920×1080」这类元数据与实际流不一致的情况，
角标按平台档位显示，真实分辨率放在悬浮提示里，不藏着。

### dash + MSE 播放（`src/utils/dashPlayer.ts`）

dash 的视频轨和音频轨是两个 URL，而 `<video>` 一次只能播一个，
所以用 MSE 把两轨塞进同一个 MediaSource 的两个 SourceBuffer 里 ——
对外仍然只有一个媒体元素，进度 / 音量 / 续播 / SMTC 这些现有逻辑一行都不用改。

**默认清晰度**由 `electron/main/biliApi.ts` 的 `PREFERRED_QN` 决定（116 = 1080P 60帧）。
它只是「尽量达到」的目标：dash 响应一次会回来**所有**档位（实测最高 4K），
由 `pickDashVideo` 挑「不超过它里最高的一条」，并且优先 H.264（`avc1`）——
AV1 / HEVC 在部分机器上 `MediaSource.isTypeSupported` 会返回 false。
不这么挑的话默认会播 `dash.video[0]`，也就是一上来拉满 4K，流量和内存都很夸张。

**内存 / 配额是这里最容易踩的坑**：1080P60 的 4 分钟视频整条流约 150MB，
正好顶到 Chromium 单个 SourceBuffer 的配额，`appendBuffer` 会抛 `QuotaExceededError`；
一旦不处理，之后再也塞不进任何数据、**播放直接卡死**。所以做了两件事：

1. **限流**：只往播放位置前面缓冲 `MAX_AHEAD_S`（30 秒），超了就等播放推进；
2. **裁剪**：配额超限时丢掉播放位置之前的数据（保留 `KEEP_BEHIND_S` 秒供回拖），
   并按 `KEEP_BEHIND_STEPS` 逐级加大丢弃幅度再重试。

> 代价：拖动进度只在**已缓冲的区间**内是瞬时的。往回拖超过保留窗口、
> 或往前拖很远处，都要等数据到达（顺序下载，不是按需分片）。
> 想彻底解决要给 dash 分片做 `sidx` 解析 + Range 请求，目前没做。

**失败兜底**：`DashSession.start()` 只有在**两条流都取完**时才 resolve，
任何一条失败都抛错 —— 只拿到音频是「黑屏有声」，只拿到视频是「哑巴」，
都不如退回 720P 的混流 durl。渲染层收到失败后会重新解析一次（`noDash: true`），
连续失败两次就认为这台机器上 dash 不可用，本会话不再尝试。

> 注意：走 dash 时主进程回的 `videoUrl` 是 `null`（没有额外去要 durl），
> 所以渲染层的兜底**必须重新解析**，不能指望本地有个 durl 地址可以顶上。

### 登录态（踩坑记录）

**结论：登录态以 nav 接口的 `isLogin` 字段为唯一权威；cookie 存在只当触发器，不当结论。**

原来「登录之后要重启一次才生效」，根因有三个叠在一起：

1. **登录成功只靠 `did-navigate` 判断**。B 站登录可能走 SPA 内部跳转，
   用户也可能登录完直接手动关窗 —— 这两条路都不触发导航事件，
   于是「登录成功」没人告诉主进程。
   现在改成 **cookie 变化当触发器 + 接口裁定**：
   - 打开登录窗口时先记下当前 SESSDATA 的值；
   - 登录窗口存活期间每秒轮询一次，`closed` 时再查一次；
   - 只有 SESSDATA **变了**（避免把本来就有的过期 cookie 当成登录成功）才清 nav 缓存、
     问一次 `isLogin`，以接口为准。

2. **nav / wbi / 用户信息缓存没有失效**。`cachedUserInfo`、`cachedMixinKey` 是启动时
   （多半是未登录）取的，登录后没人清，`isLoggedIn()` 一直是 `false`。
   现在登录成功的收尾里显式 `biliApi.clearNavData()`。

3. **判断缓存能不能用时读的是过期状态**。`resolveVideo` 里原来直接 `biliApi.isLoggedIn()`，
   拿到的是启动时那份陈旧结论。现在换成 `await biliApi.ensureLoginState()`：
   登录态未知或超过 60 秒就重新拉一次 nav（`electron/main/biliApi.ts`）。

`loginState` 用 `null` 表示「还不知道」，和 `false` 区分开 —— 拿不准时必须问接口，
不能沿用旧结论，否则登录完那一刻的判断一定是错的。

### 缓存里的播放地址什么时候该重新解析

`resolveVideo` 现在有三个独立的失效条件，命中任意一个就重新解析：

| 条件 | 判据 |
| --- | --- |
| 缓存数据不完整 | 缺 `view_result` 或 `playurl_result` |
| **地址过期** | `isUrlUsable()`：直链带签名时效（`deadline`），提前 5 分钟算过期 |
| **登录态变了** | `playurl_result.loginState` 是解析当时的快照；<br>「快照是未登录 + 现在已登录」说明这地址是低清晰度时期取的，必须重取 |

最后一条是 `/api/resolveVideo` 里新加的：登录能解锁更高档位（实测同一视频
匿名 `accept_quality=[64,16]`，登录后 `[116,80,64,16]`），不重取的话
登录完还得等切歌（甚至重启）才生效。另外渲染层在登录成功后会主动
用 `skipCache` 重取**当前正在播**的那个视频（`onLoggedIn`），并保留播放进度。

### 全屏与桌面壁纸（踩坑记录）

**结论：主窗口是 `transparent: true`，Windows 上透明窗口的原生全屏是失效的，
所以「全屏」改成应用层模拟，不要调用 `setFullScreen()`，也不要读 `isFullScreen()`。**

实测（Electron 42 / Windows，`setFullScreen(true)` 后 600ms 读回）：

| 窗口配置 | `isFullScreen()` |
| --- | --- |
| 普通窗口 | `true` |
| `frame: false` | `true` |
| `transparent: true` | **`false`** |
| `transparent: true` + `frame: false`（本项目） | **`false`** |
| 同上 + `thickFrame:false` / `roundedCorners:false` / `hasShadow:false` / `resizable:true` | **`false`** |
| 同上，但先 `setBounds` 到整屏再 `setFullScreen` | **`false`** |

透明窗口下 `setFullScreen(true)` 只会把窗口撑到屏幕大小，`isFullScreen()` 永远返回 `false`
（参见 [electron#27286](https://github.com/electron/electron/issues/27286)）。老代码拿它当唯一真相，
于是产生了一整套连环 bug：

- 全屏标志被原生值回写 → 渲染进程的 `isFullscreen` 永远是 `false`，按钮一直显示「全屏」；
- 再点「全屏」时 `!isFullScreen` 依然为 `true` → 只会一路「进入全屏」，**退不出去**；
- 从全屏切到壁纸时，还原点记到的是「非全屏」，退出壁纸就掉回普通窗口，
  而**挂壁纸层时窗口还是普通尺寸** → 「进了壁纸模式但没在壁纸层全屏」。

现在的做法（`electron/main/index.ts`）：

- `applyFullScreenGeometry()`：`setAspectRatio(0)`（免得宽高比约束改写 `setBounds`）+ 
  `setBounds(主屏 bounds)` + `setAlwaysOnTop(true)`（不置顶的话任务栏会压在窗口上面）。
- 全屏状态由主进程的 `isFullScreen` 变量持有，`win:isFullscreen` 直接返回它，
  **不再**是 `mainWindow.isFullScreen()`；`resize` 事件也不再回写这个变量。
- 两层还原点，互不污染：
  - `fullScreenRestore`：进入全屏前的普通窗口尺寸 / 最大化状态，退出全屏时用；
  - `wallpaperRestore`：进入壁纸**之前**的状态（含「当时是不是全屏」），退出壁纸时用。
    所以「全屏 → 壁纸 → 应用程序」会回到全屏，且此时依然能正常退出全屏。
- 先铺满窗口、等 120ms 让系统应用尺寸，**再** `asWallpaper.attach()`，否则挂载拿到的是旧几何。
- 壁纸模式下 `win:toggleFullscreen` 直接返回（几何由壁纸层接管）。

### 切歌后播放器信息不刷新（踩坑记录）

现象：切歌时底部控制栏的**歌曲封面、歌曲名、视频标题**都停在上一首不变。

原因是两条独立的坑叠在一起：

**1. 本地就能确定的信息却排在网络请求后面**

歌曲名、专辑封面、歌单高亮全都来自本地歌单数据，但 `changeSong` 原来把它们放在
`await searchSong()` **之后**。搜索缓存未命中时这是一次真网络请求（1~3 秒），
搜索失败时就永远不回来了 —— 于是「切了歌，名字和封面还是上一首的」。

现在 `changeSong` 一进来就先同步切好本地信息：

```ts
this.currentIndex = index      // 歌单高亮 + 专辑封面（currentCover 优先取 song.cover）
this.songName = songName       // 副标题「歌手 · 专辑」
this.videoName = ''            // 清掉上一首的视频标题
```

视频标题暂时空白时，模板用 `:videoName="videoName || songName"` 兜底显示歌名占位，
等搜索返回再换成真正的视频标题 —— 绝不会出现「新歌配旧视频标题」。
实测刷新延迟从 550+ms 降到 60ms 左右。

**2. `api:resolveVideo` 把搜索缓存里的条目写坏了**

`resolveVideo` 原来这样更新缓存条目：

```ts
targetVideo = { bvid, view_result, playurl_result }   // ← 整个替换
```

搜索结果条目里的 `title` / `pic` / `author` 全被丢掉，而这个数组会被写回搜索缓存。
后果是：

- 下次 `searchSong` 拿到的这一项没有标题和封面 → 播放器标题空白、视频封面回退不出来；
- 由于 `selectedBvid` 指向的正是「你上次播的那个视频」，**切回同一首歌必然命中这条坏数据**；
- 还会把 `title: ''` / `cover: null` 写进歌单的 `videoCache`，续播也一起坏掉。

现在改成「合并」而不是替换，并且每次解析都做一次回填：

```ts
targetVideo = { ...targetVideo, bvid, view_result, play_result }  // 保留 title / pic
targetVideo = backfillFromView(targetVideo)                       // 用 view_result 补齐
```

之所以要 `backfillFromView`：缓存**命中**时走的是「地址还能用」分支，
根本不会碰条目，已经写坏的缓存不会自己好。回填后随 `results` 一起写回，坏数据随使用自愈。

同时 `api:resolveVideo` 直接回传正在解析的那个视频的 `title` / `pic`，
渲染层不必再依赖「`videoList` 里能不能找到这个 bvid」——
`selectedBvid` 是历史选择，完全可能不在本次搜索结果里，那时列表查不到，
标题和封面就只能空着。`videoCache` 的写入也改成「非空优先」，不再让空值覆盖已有记录。

### 数据存储

```ts
// playlists.json —— 歌单集合
{
  version, currentId,
  playlists: [{
    id, name, source, sourceUrl,
    songs: [{            // 结构化曲目：可直接展示封面/专辑
      name, singer, album, cover, duration
    }],
    sync: { mode: 'off' | 'startup' | 'interval', intervalMs },
    lastSyncAt, createdAt, updatedAt,
    lastIndex,             // 该歌单上次播放到第几首
    videoCache: {          // key = "歌名-歌手"，续播时精确还原同一个视频
      '歌名-歌手': { bvid, title, cover, pickedAt }
    }
  }]
}
```

曲目从早期的 `"歌名-歌手"` 字符串数组升级为对象：旧数据会在启动时**自动解析迁移**
（按第一个 `-` 切分歌名与歌手），不会丢数据。搜索/匹配链路仍统一用
`toSearchKey(song)` 拼出与旧版完全一致的 `"歌名-歌手"`，所以匹配打分、
搜索缓存 key、`videoCache` key 都不受影响。

> 旧歌单迁移后没有专辑/封面的元信息（原始字符串里本来就没有），
> 对该歌单点一次「同步」即可从音乐平台补齐。

旧版单歌单 `playlist.json` 会在首次启动时**自动迁移**成集合里的第一条记录（迁移后旧文件改名为 `.migrated`，不会丢失）。

续播相关的信息存在 `setting.json` 里：`player.resumeOnStart`、`player.resumePlaybackTime`、`player.playIndex`、`player.resumeTime`。
记录时机：切歌、切视频、视频加载完成、播放进度变化（节流 5 秒）、关闭窗口前。

### 歌单解析（对应 LX 的 musicSdk）

用户粘贴分享链接 → 自动识别平台 → 解析出 `歌名 / 歌手` → 逐首到 B站 搜索播放。

```
渲染进程  window.electronAPI.getPlaylistDetail({ input })
   └─ IPC 'music:getPlaylistDetail'
        └─ electron/main/music/index.ts   按链接 host 自动识别音源（wy / tx / kw）
             └─ sources/<source>.ts       各平台自己解析自己格式的链接
                  └─ 返回 { info, songs: [{ name, singer, interval }], total }
```

支持的链接形式：

| 平台 | 链接示例 |
| --- | --- |
| 网易云音乐 | `https://music.163.com/#/playlist?id=xxx`（也支持 `xxx###token` 注入 MUSIC_U） |
| QQ音乐 | `https://y.qq.com/n/ryqq/playlist/xxx` 或 `.../playlist/xxx.html` |
| 酷我音乐 | `https://www.kuwo.cn/playlist_detail/xxx` |

移植时与 LX 的几处有意差异：

1. **跑在主进程**：LX 的 `musicSdk` 在渲染进程里直接用 `crypto`/`Buffer`/`needle`
   （靠 webpack `target: 'electron-renderer'`）。本项目是 `contextIsolation: true` +
   `nodeIntegration: false`，所以解析逻辑放在主进程，只通过 IPC 把结果给渲染进程。
2. **请求层用 Node `http`/`https`**：实测在主进程用 Electron `net.request` 请求腾讯域名会稳定
   返回 `net::ERR_BLOCKED_BY_CLIENT`（网易云/酷我正常），换成 Node 内建模块后稳定可用；
   而且 Node 默认不跟随重定向，能直接读到 `location` 头，正好解决短链解析。
3. **自动识别音源**：LX 让用户在弹窗里手选音源，本项目按链接 host 自动判断，
   体验更省事；纯数字 ID 因无法判断平台会给出明确提示。
4. **返回结构精简**：LX 的歌曲对象还带 `qualitys`/`typeUrl` 等取播放地址用的字段，
   本项目只要 歌名/歌手/时长，全部砍掉。

## 使用说明

1. **添加歌单**：点左上角「歌单 → 新建歌单」粘贴分享链接；首次启动没有歌单时会自动弹出添加框（支持 **网易云音乐 / QQ音乐 / 酷我音乐**，自动识别平台）
2. **切换歌单**：左上角「歌单」下拉里点一下即可，每个歌单各自记住播放到第几首
3. **自动同步**：新建/编辑歌单时选择「手动同步 / 每次启动同步 / 定时自动同步（可选间隔）」，或随时点「全部同步」。只有设置过分享链接的歌单才能自动同步。
4. **自动续播**：默认开启。下次打开会自动回到上次的歌单、歌曲和播放进度；可在「设置 → 播放」里关掉，或只关掉「恢复播放进度」
5. 点击右上角用户头像可登录 B站 账号，登录后可获取更高清的视频资源
6. 点击「桌面壁纸」按钮可将播放器嵌入桌面壁纸（此时会铺满整个桌面），再次点击恢复为原来的窗口状态
   （进壁纸前是全屏就回到全屏，是最大化就回到最大化，普通窗口就回到原来的尺寸）
7. 壁纸模式下登录窗口会显示 15 秒倒计时并自动关闭
8. 底部控制栏支持播放、暂停、上下曲、音量调节和进度条拖拽
9. 视频加载失败会自动跳过缓存重试一次，仍失败则跳到下一首

## 配置文件位置

| 内容 | 路径 |
| --- | --- |
| 应用配置（含续播位置） | `%APPDATA%/BiLiSongVideo-desktop/setting.json` |
| 歌单集合 | `%APPDATA%/BiLiSongVideo-desktop/playlists.json` |
| 旧版单歌单（已迁移） | `%APPDATA%/BiLiSongVideo-desktop/playlist.json.migrated` |
| 搜索缓存 | `%APPDATA%/BiLiSongVideo-desktop/search-cache/` |

### 关于存储：为什么用 JSON 而不是 SQLite

`setting.json` 约 2KB、`playlists.json` 约 5KB（217 首），且写入是「整体替换」语义
（先写临时文件再 rename 原子替换），没有部分更新、并发写、按行查询的需求 ——
这些正是 SQLite 的强项而本项目一个都用不到。同时 SQLite 是原生模块，
要额外处理 `asarUnpack` / ABI / 跨平台重编译，为一个 5KB 的文件不值得。

**真正需要淘汰策略的是搜索缓存**，那是文件级 KV，天然适合 TTL + LRU，
用「每键一文件 + 内存索引」实现即可，同样不需要 SQLite。见下。

### 搜索缓存策略

缓存项存的是**整包 B 站搜索响应**（含各候选视频的播放地址），单文件可达数 MB，
所以必须有过期与淘汰，否则只增不减（曾实测到 45MB / 107 文件，88% 已超 3 天）。

- **过期**：`cache.maxAge`（默认 3 天）在**读取时**判定，过期按未命中处理并删除
- **容量**：文件数上限 300，超出时按「最久未使用」淘汰到 80%（240）以下
- **索引**：内存索引记录每个文件的使用时间，并在需要时与磁盘对齐
  （应对外部删文件、上次未正常退出等情况）
- 设置里可查看占用、手动「清理过期」或「全部清除」

> 说明：`cache.enable` 与 `cache.maxAge` 在早期版本里只是声明了却从未被读取，
> 属于「死设置」；现已真正生效。

**便携模式**：在 exe 同级目录放一个 `portable` 文件夹，
主进程会在最早期把 `userData` 改写到 `portable/userData`，实现绿色免安装。

## 免责声明

- 本程序为个人学习与兴趣开发，**仅供个人免费使用，请勿用于商业用途**。
- 本程序为桌面端工具，**所有数据存储在用户本地**，不涉及云端服务，不收集任何用户信息。
- B站（bilibili.com）相关接口为社区维护方案，非官方开放 API。本程序仅提供歌单解析与视频搜索的本地自动化操作，不破解、不修改 B 站官方客户端或网页端功能。
- 歌单解析功能参考 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)（Apache-2.0）的实现思路，涉及的网易云 / QQ音乐 / 酷我音乐接口均为**社区逆向所得的非官方接口**，仅用于读取用户主动提供链接的歌单曲目信息（歌名 / 歌手），不涉及音源下载与破解。这些接口随时可能失效或变更。
- 若本程序涉及的任何功能侵犯了您的合法权益，请联系删除。

## 许可证

[GPL-3.0](LICENSE)
