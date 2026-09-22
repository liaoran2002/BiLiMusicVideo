/**
 * 默认配置对象
 *
 * 通过 `satisfies LX.AppSetting` 做 TS 强校验：
 *  - 少写任何一个 key 都会报错
 *  - 写错 key 名或值的类型都会报错
 * 同时 `as const` 语义保留字面量类型，便于推导。
 *
 * 参考 LX Music 的 src/common/defaultSetting.ts
 */
import {
  DEFAULT_AUDIO_ID,
  DEFAULT_FONT_COLOR,
  DEFAULT_THEME_COLOR,
  DEFAULT_VIDEO_QN,
  SETTING_VERSION,
} from './constants'
import type { AppSetting } from './types/app_setting'

const defaultSetting = {
  version: SETTING_VERSION,

  // #region common
  'common.wallpaperMode': false,
  /** 玻璃底色：默认白色（浅色主题那套观感） */
  'common.themeColor': DEFAULT_THEME_COLOR,
  /** 浮层文字颜色：默认白色 */
  'common.fontColor': DEFAULT_FONT_COLOR,
  /**
   * 透明度：玻璃底色 `rgba(255,255,255,x)` 里的 x（百分比）
   * 30 = `rgba(255,255,255,0.3)`，和加这个设置之前的观感一致
   */
  'common.glassTransparency': 30,
  /**
   * 模糊强度：`backdrop-filter: blur(Npx)` 的 N（0-20）
   * 界面上显示成百分比（50% = 10px），存的是这个 px 值
   */
  'common.glassBlur': 10,
  /**
   * 阴影强度：文字阴影的模糊半径（0-20 px，界面显示成百分比：8px = 40%）
   * 8 就是原来的「0 1px 4px + 0 0 8px」
   */
  'common.glassShadow': 8,
  // #endregion

  // #region player
  'player.volume': 70,
  'player.isMute': false,
  'player.loopMode': 'listLoop',
  'player.playIndex': 0,
  /** 自动续播：下次打开恢复到上次的歌单/歌曲/进度 */
  'player.resumeOnStart': true,
  /** 续播时连播放进度一起恢复 */
  'player.resumePlaybackTime': true,
  /** 上次播放到的秒数 */
  'player.resumeTime': 0,
  /** 默认视频清晰度：1080P 60帧（实际会按登录态/会员/视频可用档位降级） */
  'player.videoQuality': DEFAULT_VIDEO_QN,
  /** 默认音质：192K */
  'player.audioQuality': DEFAULT_AUDIO_ID,
  /**
   * 标题关键词加权配置（沿用旧版 App.vue 里硬编码的 tagBonusConfig）
   * score 越大越优先；负数表示降权。
   */
  'player.tagBonus': {
    '5': [
      'MV',
      'Official',
      '官方',
      '原唱版',
      '华语MV',
      '原版',
      '蓝光',
      '超清',
      '4K',
    ],
    '3': [
      'Live',
      '高清',
      '无损',
      'Hi-Res',
      'Hi-Fi',
      '高音质',
      '录音棚',
      '动态歌词',
      '微电影',
      '音乐现场',
      '演唱会',
      '舞台',
      '原画',
      '8K',
      '2K',
      '1080P',
      '杜比音效',
      '全景声',
      'DTS',
      '母带音质',
      '现场版',
      '巡演',
      '音乐节',
      '录音室',
      '超清原画',
      '动态频谱',
      '沉浸式音效',
    ],
    '-2': [
      '翻唱',
      '合唱',
      '阿卡贝拉',
      '书本打击',
      '音乐可视化',
      '音高可视化',
      '录屏',
      '歌单',
      '精选歌单',
      '电台',
      '改编',
      '萌系翻唱',
      '双人合唱',
      '多人合唱',
      '可视化音频',
      '歌词可视化',
      '录屏版',
      '私人歌单',
      '主题歌单',
      '音乐电台',
      '情感电台',
      '分享',
      '推荐',
      '翻唱合集',
      '混剪',
      '卡点',
    ],
    '-4': [
      '演奏',
      '口琴',
      '萨克斯',
      '吉他',
      '架子鼓',
      '非洲鼓',
      '钢琴',
      '古筝',
      '打击乐',
      '小提琴',
      '大提琴',
      '二胡',
      '琵琶',
      '竹笛',
      '扬琴',
      '贝斯',
      '电子琴',
      '手鼓',
      '马林巴',
      '纯音乐演奏',
      '乐器独奏',
      '乐器合奏',
      '即兴演奏',
      '指弹吉他',
    ],
    '-6': [
      '教学',
      '教程',
      '鼓谱',
      '吉他谱',
      '动态鼓谱',
      '卡拉OK',
      '歌词排版',
      'VJ素材',
      '零基础教学',
      '进阶教程',
      '钢琴谱',
      '简谱',
      '五线谱',
      '动态谱',
      '字幕排版',
      'VJ循环素材',
      '背景音乐素材',
    ],
    '-20': ['伴奏', '纯伴奏', '无和声', '消音', 'instrumental'],
  },
  // #endregion

  // #region cache
  'cache.enable': true,
  'cache.maxAge': 3 * 24 * 60 * 60 * 1000,
  // #endregion
} satisfies AppSetting

export default defaultSetting
