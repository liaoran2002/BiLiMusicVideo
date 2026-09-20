<template>
  <div id="songListPanel" v-show="listType != 'none'">
    <div id="listMask" @click="$emit('showList', 'none')"></div>
    <div class="list" :class="{ wide: isSongList }">
      <div class="listTitle">
        <span class="lt-name">{{ title }}</span>
        <span class="lt-count">{{ list.length }} 项</span>
      </div>
      <div class="listBody" ref="listBody">
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
          </li>
        </ul>
      </div>
    </div>
  </div>
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
  /** 时长（秒） */
  duration?: number | null;
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
  emits: ['showList', 'changeSong', 'changeVideo'],
  data() {
    return {
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
  },
  computed: {
    isSongList(): boolean {
      return this.listType === 'list';
    },
  },
  watch: {
    listType(val: string) {
      if (val !== 'none') {
        this.$nextTick(() => this.scrollToActive());
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
      if (isVideoItem(item)) return formatSeconds(item.duration) ?? '';
      return item.duration ?? '';
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
    onItemClick(item: ListItem, index: number) {
      if (this.isSongList) this.$emit('changeSong', index);
      else this.$emit('changeVideo', (item as VideoListItem).bvid, this.title);
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
.list {
  text-align: center;
  position: fixed;
  top: 50%;
  left: 50%;
  user-select: none;
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  padding: 30px;
  min-width: 50vw;
  box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
  transform: translate(-50%, -50%);
  max-height: 50vh;
  color: white;
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.5s ease,
    visibility 0.5s ease;
  z-index: 999;
}
/* 歌单模式内容更多，放宽一点 */
.list.wide {
  min-width: 56vw;
  max-height: 62vh;
}

.listTitle {
  color: #000;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  padding: 15px 0;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 12px 12px 0 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.5);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
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

#listMask {
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  width: 100vw;
  opacity: 0.5;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1;
}

.show {
  visibility: hidden;
  opacity: 0;
}

.listBody {
  margin-top: 25px;
  max-height: 50vh;
  overflow-y: auto;
}
.list.wide .listBody {
  max-height: 56vh;
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
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #000;
  margin: 1% 0;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.lists li:hover {
  background: rgba(255, 255, 255, 0.35);
}

.lists .index {
  flex: none;
  width: 32px;
  text-align: center;
  padding: 4px 0;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(0, 0, 0, 0.3);
  color: white;
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
  color: rgba(255, 255, 255, 0.75);
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
  color: #d03050;
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
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.5);
  color: black;
}

.lists li.active {
  background: rgba(102, 120, 232, 0.32);
}
.lists li.active .index {
  background: rgba(232, 17, 35, 0.5);
  border-color: rgba(232, 17, 35, 0.6);
  color: white;
}
.lists li.active .title {
  font-weight: 600;
}
</style>
