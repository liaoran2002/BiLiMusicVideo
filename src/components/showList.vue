<template>
  <!--
    歌曲 / 视频列表

    和设置、歌单管理一样是 el-dialog：
    右上角没有叉号（show-close=false），点弹窗外面的空白处关闭；
    「点击空白位置关闭」的提示由 App.vue 里遮罩的 ::after 统一提供。
  -->
  <el-dialog
    :model-value="listType != 'none'"
    :show-close="false"
    :width="isSongList ? '56vw' : '50vw'"
    align-center
    @update:model-value="onVisibleChange"
  >
    <template #header>
      <div class="listTitle">
        <!-- 左：刷新（两种列表共用一个按钮，动作不同）
             歌曲列表 -> 重新同步歌单；视频列表 -> 重新搜索这首歌
             点击时图标转 360°、0.5s，作为「点到了」的反馈 -->
        <div class="lt-side">
          <button
            class="lt-icon lt-refresh"
            :class="{ spin: spinning }"
            :title="isSongList ? '重新同步歌单' : '重新搜索这首歌'"
            @click="onRefresh"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13.2 6.2A5.4 5.4 0 1 0 13.4 9.2" />
              <path d="M13.4 2.8v3.5h-3.5" />
            </svg>
          </button>
        </div>
        <!-- 中：标题 + 项数 -->
        <div class="lt-center">
          <span class="lt-name">{{ title }}</span>
          <span class="lt-count">{{ list.length }} 项</span>
        </div>
        <!-- 右：加号（只有视频列表有，打开「添加视频」） -->
        <div class="lt-side lt-end">
          <button v-if="!isSongList" class="lt-icon" title="添加视频" @click="$emit('addVideo')">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M8 3.2v9.6M3.2 8h9.6" />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <div id="songListPanel" class="listBody" ref="listBody">
      <ul class="lists">
        <li
          v-for="(item, index) in list"
          :key="index"
          :ref="(el) => setItemRef(index, el)"
          :class="{ active: index === currentIndex }"
          @click="onItemClick(item, index)"
        >
          <div class="index">{{ index + 1 }}</div>

          <!-- 封面：歌单取平台专辑图，视频取 B 站缩略图 -->
          <div class="cover">
            <img
              v-if="coverOf(item) && !failedCovers[coverOf(item) as string]"
              :src="coverOf(item) as string"
              :alt="nameOf(item)"
              referrerpolicy="no-referrer"
              loading="lazy"
              @error="onCoverError($event)"
            />
            <div v-else class="cover-fallback">
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

          <!-- 文本区 -->
          <div class="meta">
            <div class="title" :title="plainTitleOf(item)" v-html="titleHtmlOf(item)"></div>
            <div class="sub">
              <span v-if="singerOf(item)" class="singer">{{ singerOf(item) }}</span>
              <span v-if="albumOf(item)" class="album" :title="albumOf(item)">
                {{ albumOf(item) }}
              </span>
            </div>
          </div>

          <!-- 时长 -->
          <div v-if="durationOf(item)" class="duration">{{ durationOf(item) }}</div>

          <!--
            收藏（空心爱心 / 实心爱心）：只在视频列表里出现
            点了立刻变实心，收藏项在重新搜索后会固定排在最前面
          -->
          <div
            v-if="!isSongList"
            class="fav"
            :class="{ on: isFav(item) }"
            :title="isFav(item) ? '取消收藏' : '收藏'"
            @click.stop="$emit('toggleFavorite', bvidOf(item))"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              :fill="isFav(item) ? 'currentColor' : 'none'"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
            >
              <path d="M8 13.1S2.3 9.7 2.3 6.2c0-1.7 1.3-3 3-3 1.2 0 2.2.7 2.7 1.7.5-1 1.5-1.7 2.7-1.7 1.7 0 3 1.3 3 3 0 3.5-5.7 6.9-5.7 6.9z" />
            </svg>
          </div>
        </li>
      </ul>
    </div>
  </el-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import type { PlaylistSong } from '@common/types/playlist';
import { normalizeImageUrl } from '../utils/image';

/**
 * 视频列表项（B 站搜索结果）
 *
 * 后端缓存里可能还带 view_result / playurl_result，这里只声明用到的字段。
 */
export interface VideoListItem {
  bvid: string;
  title: string;
  /** B 站缩略图 */
  pic?: string | null;
  /** UP 主名 */
  author?: string | null;
  /** 时长（秒）；B 站搜索接口给的是 "4:03" 这种字符串，所以两种都收 */
  duration?: number | string | null;
}

type ListItem = PlaylistSong | VideoListItem;

const isVideoItem = (item: ListItem): item is VideoListItem =>
  typeof (item as VideoListItem).bvid === 'string';

/** 秒 -> mm:ss */
const formatSeconds = (sec: number | null | undefined): string | null => {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${p(m)}:${p(s)}`;
};

/**
 * 时长文案（两种数据形状都要认）
 *
 * 踩过：B 站**搜索**接口给的 `duration` 是 `"4:03"` 这种**字符串**，
 * 而 **view** 接口给的是秒数。原来只处理数字，于是「刷新」走真实重搜之后
 * （搜索结果覆盖了缓存里的旧数据），视频列表的时长整列消失。
 * 这里两种都接受：已经是 `mm:ss` 就直接用，是数字（或数字字符串）再格式化。
 */
const durationText = (raw: number | string | null | undefined): string => {
  if (typeof raw === 'number') return formatSeconds(raw) ?? '';
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return '';
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s;
    const n = Number(s);
    if (Number.isFinite(n)) return formatSeconds(n) ?? '';
  }
  return '';
};

/** 把文本里的 HTML 特殊字符全部转义，杜绝注入 */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** 去掉所有标签，得到纯文本（用于 title 提示） */
const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '');

/**
 * 净化标题 HTML
 *
 * B 站的搜索接口会在标题里用 `<em class="keyword">` 高亮命中的关键词，
 * 这个高亮要保留（原实现直接 v-html 渲染）。
 * 但歌单曲目名来自音乐平台/用户输入，直接 v-html 有注入风险。
 *
 * 做法：先整体转义，再把**仅有的 `<em ...>` / `</em>`** 还原。
 * 这样既留住 B 站高亮，其余一切标签都会被当作文本显示。
 *
 * 注意：转义后属性里的引号会变成 `&quot;`，所以匹配属性时
 * **必须允许 `&`**（用 `[\s\S]*?`），否则 `<em class="keyword">` 这种
 * 带属性的开标签会匹配不上，只剩闭标签被还原，反而产生破损 HTML。
 */
const sanitizeTitleHtml = (raw: string): string => {
  const escaped = escapeHtml(raw);
  return escaped
    .replace(/&lt;em(?:\s[\s\S]*?)?&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>');
};

export default defineComponent({
  name: 'showList',
  emits: [
    'showList',
    'changeSong',
    'changeVideo',
    /** 左上角刷新：歌单列表=重新同步，视频列表=重新搜索 */
    'refresh',
    /** 右上角加号：打开「添加视频」 */
    'addVideo',
    /** 爱心：收藏 / 取消收藏某个视频 */
    'toggleFavorite',
  ],
  data() {
    return {
      /** 刷新图标正在转圈（0.5s） */
      spinning: false,
      _spinTimer: null as ReturnType<typeof setTimeout> | null,
      itemRefs: {} as Record<number, HTMLElement>,
      /**
       * 加载失败的封面地址集合
       *
       * 不能像原来那样对 `img` 直接写 `style.display = 'none'`：
       * 列表项是 `:key="index"`，切歌单 / 切到视频列表时同一位置的 `<li>`
       * 会被复用，那个内联样式既不会被 Vue 清掉，还会串到后来的歌上 ——
       * 结果是某一行一旦加载失败，那一行的封面就永远是空的。
       * 改成按地址记录，换一个地址就有一次新的机会。
       */
      failedCovers: {} as Record<string, boolean>,
    };
  },
  props: {
    title: {
      type: String,
      default: '',
      required: true,
    },
    list: {
      type: Array as () => ListItem[],
      required: true,
    },
    listType: {
      type: String,
      default: 'none',
      required: true,
    },
    currentIndex: {
      type: Number,
      default: 0,
    },
    /** 当前这首歌收藏的 bvid 列表（视频列表里显示实心爱心） */
    favorites: {
      type: Array as () => string[],
      default: () => [],
    },
  },
  computed: {
    isSongList(): boolean {
      return this.listType === 'list';
    },
  },
  watch: {
    listType(val: string) {
      if (val !== 'none') {
        // 弹窗挂载 + 过渡要一点时间，等一拍再滚到当前项
        setTimeout(() => this.scrollToActive(), 120);
      }
    },
  },
  methods: {
    setItemRef(index: number, el: unknown) {
      if (el) this.itemRefs[index] = el as HTMLElement;
      else delete this.itemRefs[index];
    },
    /** 歌名 / 视频标题 */
    nameOf(item: ListItem): string {
      return isVideoItem(item) ? item.title : item.name;
    },
    /** 纯文本标题（用于 title 提示与 alt） */
    plainTitleOf(item: ListItem): string {
      return stripTags(this.nameOf(item));
    },
    /**
     * 标题 HTML
     *
     * 视频项保留 B 站的 `<em>` 关键词高亮（这是原始行为，必须保留）；
     * 歌单项没有搜索词可高亮，但同样走净化，避免曲目名里的 `<` 之类被当成标签。
     */
    titleHtmlOf(item: ListItem): string {
      return sanitizeTitleHtml(this.nameOf(item));
    },
    /** 歌手；视频项显示 UP 主 */
    singerOf(item: ListItem): string {
      return isVideoItem(item) ? (item.author ?? '') : item.singer;
    },
    /** 专辑名（仅歌单项有） */
    albumOf(item: ListItem): string {
      return isVideoItem(item) ? '' : (item.album ?? '');
    },
    /** 封面：歌单用平台专辑图，视频用 B 站缩略图 */
    coverOf(item: ListItem): string | null {
      if (isVideoItem(item)) return normalizeImageUrl(item.pic);
      return normalizeImageUrl(item.cover);
    },
    durationOf(item: ListItem): string {
      if (isVideoItem(item)) return durationText(item.duration);
      return durationText(item.duration);
    },
    /** 图片挂了就记下这个地址，露出兜底图标（避免一直显示破图） */
    onCoverError(e: Event) {
      const img = e.target as HTMLImageElement;
      const src = img.getAttribute('src');
      if (!src) return;
      // 兜底：长期浏览视频列表会让这张表慢慢变大，超了就整体清掉重来
      if (Object.keys(this.failedCovers).length > 2000) this.failedCovers = {};
      this.failedCovers[src] = true;
    },
    /** 视频项的 bvid（歌单项返回空串，模板里就不用写类型断言了） */
    bvidOf(item: ListItem): string {
      return isVideoItem(item) ? item.bvid : '';
    },
    /** 这一项是不是已收藏 */
    isFav(item: ListItem): boolean {
      const bvid = this.bvidOf(item);
      return !!bvid && this.favorites.includes(bvid);
    },
    /**
     * 左上角刷新
     *
     * 先复位再激活，保证连点也能重新播放转圈动画（CSS 动画靠类名重加才会重播）。
     * 真正干什么由父组件按列表类型决定。
     */
    onRefresh(): void {
      this.spinning = false;
      void this.$nextTick(() => {
        this.spinning = true;
        if (this._spinTimer) clearTimeout(this._spinTimer);
        this._spinTimer = setTimeout(() => {
          this.spinning = false;
          this._spinTimer = null;
        }, 500);
      });
      this.$emit('refresh');
    },
    onItemClick(item: ListItem, index: number) {
      if (this.isSongList) this.$emit('changeSong', index);
      else this.$emit('changeVideo', (item as VideoListItem).bvid, this.title);
    },
    /** el-dialog 关掉时（点空白处 / Esc）通知父组件把 listType 置回 none */
    onVisibleChange(visible: boolean): void {
      if (!visible) this.$emit('showList', 'none');
    },
    scrollToActive() {
      const el = this.itemRefs[this.currentIndex];
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    },
  },
});
</script>

<style>
/*
 * 外框（底色 / 圆角 / 模糊 / 白字 + 阴影）由 App.vue 里 `.el-dialog` 的全局样式提供，
 * 这里只管列表内部。
 */
.listTitle {
  color: inherit;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  /*
   * 三列：左（刷新）/ 中（标题）/ 右（加号）。
   * 注意左右各自包了一层 `.lt-side`：直接放 4 个元素的话，第四个会被挤到第二行、
   * 也就是跑到左边去（加号「跑到左上角」就是这么来的）。
   */
  padding: 0 2px;
}
.lt-side {
  display: flex;
  align-items: center;
  /* 右列靠右：宽度相同才不会把中间标题挤偏 */
  min-width: 26px;
}
.lt-end {
  justify-content: flex-end;
}
.lt-center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-width: 0;
}
/* 左上角刷新 / 右上角加号：同一种图标按钮 */
.lt-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
  transition: background 0.15s, opacity 0.15s;
}
.lt-icon:hover {
  background: var(--panel-hover);
  opacity: 1;
}
/* 点一下转 360°、0.5s */
.lt-icon.spin svg {
  animation: lt-spin 0.5s ease;
}
@keyframes lt-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
/* 收藏爱心：空心 -> 实心 */
.fav {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  opacity: 0.55;
  color: var(--panel-text);
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.fav:hover {
  background: var(--panel-hover);
  opacity: 1;
}
.fav.on {
  opacity: 1;
  color: var(--accent-danger);
}
.lt-name {
  font-weight: 600;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lt-count {
  font-size: 12px;
  opacity: 0.55;
}

.listBody {
  max-height: 56vh;
  overflow-y: auto;
}

.lists {
  list-style: none;
  margin: 0;
  padding: 0;
}

.lists li {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  /* 文字颜色/阴影都从 `.el-dialog` 继承（白字 + 主题对应的阴影） */
  color: inherit;
  margin: 1% 0;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.lists li:hover {
  background: var(--panel-hover);
}

.lists .index {
  flex: none;
  width: 32px;
  text-align: center;
  padding: 4px 0;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(var(--text-rgb), 0.16);
  border: 1px solid rgba(var(--text-rgb), 0.22);
  color: var(--panel-text);
}

/* 封面：只管高度，宽度按原图比例自适应，两侧留白并居中
   （不要用固定正方形 + cover，那会把长方形封面裁掉） */
.lists .cover {
  flex: none;
  height: 40px;
  min-width: 40px;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.lists .cover img {
  height: 40px;
  width: auto;
  max-width: 96px;
  object-fit: contain;
  display: block;
}
.lists .cover-fallback {
  width: 40px;
  height: 40px;
  color: var(--panel-text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 文本区 */
.lists .meta {
  flex: 1;
  min-width: 0;
}
.lists .title {
  font-size: 13px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* B 站搜索结果里的关键词高亮（<em class="keyword">），保留原有观感 */
.lists .title :deep(em),
.lists .title em {
  font-style: normal;
  font-weight: 600;
  color: var(--accent-danger);
}
.lists .sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.7;
  overflow: hidden;
}
.lists .singer {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lists .album {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}
.lists .album::before {
  content: '· ';
}
.lists .duration {
  flex: none;
  font-size: 11px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

.lists li:nth-child(2n) .index {
  background: rgba(var(--text-rgb), 0.24);
  border-color: rgba(var(--text-rgb), 0.32);
  color: var(--panel-text);
}

.lists li.active {
  background: var(--panel-active);
}
.lists li.active .index {
  background: var(--panel-active);
  border-color: rgba(var(--text-rgb), 0.32);
  color: var(--panel-text);
}
.lists li.active .title {
  font-weight: 600;
}
</style>
