<template>
  <div class="pl-wrap">
    <!-- 左上角入口：点开是歌单快捷切换（原「设置歌单」按钮已并入这里） -->
    <div class="pl-trigger" :class="{ active: open }" @click="togglePanel" title="歌单">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
      <span class="pl-trigger-name">{{ currentName }}</span>
      <svg class="pl-caret" :class="{ flip: open }" width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>

    <!-- 快捷下拉：只做「切换 / 快速同步 / 进管理」，不再一个按钮一个弹窗 -->
    <div v-if="open" class="pl-panel" @click.stop>
      <div class="pl-header">
        <span>我的歌单</span>
        <span class="pl-count">{{ playlists.length }} 个</span>
      </div>

      <div v-if="playlists.length === 0" class="pl-empty">
        <div>还没有歌单</div>
      </div>

      <div v-else class="pl-list">
        <div
          v-for="item in playlists"
          :key="item.id"
          class="pl-item"
          :class="{ current: item.id === currentId }"
          @click="onPick(item.id)"
        >
          <div class="pl-item-main">
            <div class="pl-item-name">
              <span v-if="item.id === currentId" class="pl-dot"></span>
              {{ item.name }}
            </div>
            <div class="pl-item-meta">
              <span>{{ item.songs.length }} 首</span>
              <span v-if="item.source" class="pl-tag">{{ sourceLabel(item.source) }}</span>
            </div>
          </div>
          <span
            class="pl-action"
            :class="{ spinning: playlistsStore.isSyncingOne(item.id) }"
            title="立即同步"
            @click.stop="onSyncOne(item.id)"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.5H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
        </div>
      </div>

      <div class="pl-footer">
        <button class="pl-btn primary" @click="onManage">打开歌单管理</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { ElMessage } from 'element-plus';
import { SOURCE_LABELS } from '@common/constants';
import type { PlaylistRecord, SyncResult } from '@common/types/playlist';
import { usePlaylistStore } from '../stores/playlists';

export default defineComponent({
  name: 'PlaylistPanel',
  emits: ['switch', 'manage'],
  data() {
    return { open: false };
  },
  computed: {
    playlistsStore() {
      return usePlaylistStore();
    },
    playlists(): PlaylistRecord[] {
      return this.playlistsStore.playlists;
    },
    currentId(): string | null {
      return this.playlistsStore.currentId;
    },
    currentName(): string {
      return this.playlistsStore.current?.name || '未选择歌单';
    },
  },
  mounted() {
    document.addEventListener('click', this.onDocClick);
    document.addEventListener('keydown', this.onKeydown);
  },
  beforeUnmount() {
    document.removeEventListener('click', this.onDocClick);
    document.removeEventListener('keydown', this.onKeydown);
  },
  methods: {
    sourceLabel(source: string): string {
      return SOURCE_LABELS[source] ?? source;
    },
    togglePanel() {
      this.open = !this.open;
    },
    onDocClick(e: MouseEvent) {
      const el = this.$el as HTMLElement;
      if (el && !el.contains(e.target as Node)) this.open = false;
    },
    onKeydown(e: KeyboardEvent) {
      if (e.code === 'Escape' && this.open) this.open = false;
    },
    /** 快捷切换歌单 */
    async onPick(id: string) {
      this.open = false;
      if (id === this.currentId) return;
      await this.playlistsStore.setCurrent(id);
      this.$emit('switch', id);
    },
    /** 快捷同步单个歌单 */
    async onSyncOne(id: string) {
      try {
        const results: SyncResult[] = await this.playlistsStore.sync([id]);
        const r = results[0];
        if (r?.ok) {
          ElMessage.success(
            r.added || r.removed
              ? `《${r.name}》同步完成 +${r.added ?? 0}/-${r.removed ?? 0}`
              : `《${r.name}》已是最新（${r.count} 首）`,
          );
        } else {
          ElMessage.warning(r?.error ?? '同步失败');
        }
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err));
      }
    },
    /** 打开统一的歌单管理弹窗 */
    onManage() {
      this.open = false;
      this.$emit('manage');
    },
  },
});
</script>

<style scoped>
.pl-wrap {
  position: relative;
  pointer-events: auto;
}
.pl-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  max-width: 220px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.12);
  transition: background 0.15s;
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.5),
    0 0 8px rgba(0, 0, 0, 0.3);
}
.pl-trigger:hover,
.pl-trigger.active {
  background: rgba(255, 255, 255, 0.25);
}
.pl-trigger-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}
.pl-caret {
  transition: transform 0.18s;
  opacity: 0.8;
}
.pl-caret.flip {
  transform: rotate(180deg);
}

.pl-panel {
  position: absolute;
  top: 36px;
  left: 0;
  width: 300px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(28, 28, 32, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
  z-index: 400;
  color: #fff;
}
.pl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  opacity: 0.7;
  padding: 2px 4px 8px;
}
.pl-empty {
  font-size: 12px;
  opacity: 0.6;
  padding: 14px 6px;
  text-align: center;
}
.pl-list {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 8px;
}
.pl-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.15s;
}
.pl-item:hover {
  background: rgba(255, 255, 255, 0.1);
}
.pl-item.current {
  background: rgba(102, 120, 232, 0.28);
}
.pl-item-main {
  flex: 1;
  min-width: 0;
}
.pl-item-name {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6f8cff;
  flex: none;
}
.pl-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  opacity: 0.6;
  margin-top: 2px;
}
.pl-tag {
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.14);
  opacity: 0.9;
}
.pl-action {
  flex: none;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.85);
  opacity: 0;
  transition: opacity 0.15s;
}
.pl-item:hover .pl-action {
  opacity: 1;
}
.pl-action:hover {
  background: rgba(255, 255, 255, 0.18);
}
.pl-action.spinning {
  opacity: 1;
}
.pl-action.spinning svg {
  animation: pl-spin 0.9s linear infinite;
}
@keyframes pl-spin {
  to {
    transform: rotate(360deg);
  }
}
.pl-footer {
  display: flex;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 8px;
}
.pl-btn {
  flex: 1;
  height: 28px;
  font-size: 12px;
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  transition: background 0.15s;
}
.pl-btn.primary {
  background: rgba(102, 120, 232, 0.55);
  border-color: rgba(102, 120, 232, 0.7);
}
.pl-btn.primary:hover {
  background: rgba(102, 120, 232, 0.8);
}
</style>
