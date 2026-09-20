<template>
  <el-dialog
    :model-value="modelValue"
    title="设置"
    width="600px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => $emit('update:modelValue', v)"
  >
    <div class="st-body">
      <!-- 播放 -->
      <div class="st-group">
        <div class="st-group-title">播放</div>
        <div class="st-row">
          <div class="st-label">
            <div class="st-name">最高视频清晰度</div>
            <div class="st-desc">
              自动播放时不超过这个档位（实际哪一档由平台按登录态 / 会员等级 / 视频可用档位决定）
            </div>
          </div>
          <el-select
            :model-value="setting['player.videoQuality']"
            size="small"
            style="width: 170px"
            @update:model-value="(v: number) => set('player.videoQuality', v)"
          >
            <el-option
              v-for="opt in VIDEO_QUALITY_OPTIONS"
              :key="opt.id"
              :label="opt.description"
              :value="opt.id"
            />
          </el-select>
        </div>
        <div class="st-row">
          <div class="st-label">
            <div class="st-name">最高音质</div>
            <div class="st-desc">
              自动播放时不超过这个档位（仅在 dash 高清通道生效；durl 兜底时音质随 720P 混流）
            </div>
          </div>
          <el-select
            :model-value="setting['player.audioQuality']"
            size="small"
            style="width: 170px"
            @update:model-value="(v: number) => set('player.audioQuality', v)"
          >
            <el-option
              v-for="opt in AUDIO_QUALITY_OPTIONS"
              :key="opt.id"
              :label="opt.description"
              :value="opt.id"
            />
          </el-select>
        </div>
        <div class="st-note">
          这里是**完整档位表**：它决定自动播放时最高选到哪一档（实际能拿到哪档由平台按登录态 / 会员等级 / 视频可用档位决定）。
          控制栏上的角标是「这个视频现在能选什么」，点一下可以临时切换（不受这里的上限约束，只作用于当前这一首）。
        </div>
        <div class="st-row">
          <div class="st-label">
            <div class="st-name">自动续播</div>
            <div class="st-desc">下次打开应用时，自动回到上次的歌单与歌曲</div>
          </div>
          <el-switch
            :model-value="setting['player.resumeOnStart']"
            @update:model-value="(v: string | number | boolean) => setBool('player.resumeOnStart', v)"
          />
        </div>
        <div class="st-row">
          <div class="st-label">
            <div class="st-name">恢复播放进度</div>
            <div class="st-desc">续播时连上次播放到的秒数一起恢复，而不是从头播放</div>
          </div>
          <el-switch
            :model-value="setting['player.resumePlaybackTime']"
            :disabled="!setting['player.resumeOnStart']"
            @update:model-value="(v: string | number | boolean) => setBool('player.resumePlaybackTime', v)"
          />
        </div>
        <div class="st-note">
          循环模式与音量请在底部播放控制栏调整，会自动记录并在下次启动时恢复。
        </div>
      </div>

      <!-- 通用 -->
      <div class="st-group">
        <div class="st-group-title">通用</div>
        <div class="st-row">
          <div class="st-label">
            <div class="st-name">启动时进入桌面壁纸模式</div>
            <div class="st-desc">下次打开直接以壁纸模式运行</div>
          </div>
          <el-switch
            :model-value="setting['common.wallpaperMode']"
            @update:model-value="(v: string | number | boolean) => setBool('common.wallpaperMode', v)"
          />
        </div>
        <div class="st-row">
          <div class="st-label">
            <div class="st-name">搜索缓存</div>
            <div class="st-desc">
              {{ cacheText }} · 超期与最久未用的会自动清理
            </div>
          </div>
          <div class="st-actions">
            <el-button size="small" :loading="cacheBusy" @click="pruneCache">清理过期</el-button>
            <el-button size="small" type="danger" plain @click="clearCache">全部清除</el-button>
          </div>
        </div>
        <div class="st-row">
          <div class="st-label">
            <div class="st-name">恢复默认设置</div>
            <div class="st-desc">把上面的设置重置为默认值（不影响歌单数据）</div>
          </div>
          <el-popconfirm
            title="确定恢复所有设置为默认值吗？"
            confirm-button-text="恢复"
            cancel-button-text="取消"
            width="230"
            @confirm="resetAll"
          >
            <template #reference>
              <el-button size="small" type="danger" plain>恢复默认</el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button type="primary" @click="$emit('update:modelValue', false)">完成</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { ElMessage } from 'element-plus';
import { AUDIO_QUALITY_OPTIONS, VIDEO_QUALITY_OPTIONS } from '@common/constants';
import type { AppSetting } from '@common/types/app_setting';
import api from '../api/electron';
import { useSettingStore } from '../stores/setting';

/** 字节 -> 可读体积 */
const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export default defineComponent({
  name: 'SettingsDialog',
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  data() {
    return {
      /** 缓存占用统计 */
      cacheStats: { count: 0, bytes: 0 },
      cacheBusy: false,
      /** 完整档位表（设置页是「上限」，所以铺全表，见模板里的说明） */
      VIDEO_QUALITY_OPTIONS,
      AUDIO_QUALITY_OPTIONS,
    };
  },
  computed: {
    store() {
      return useSettingStore();
    },
    setting(): AppSetting {
      return this.store.setting;
    },
    cacheText(): string {
      const { count, bytes } = this.cacheStats;
      return `${count} 个文件 / ${formatBytes(bytes)}`;
    },
  },
  watch: {
    // 每次打开时刷新一次占用
    modelValue(visible: boolean) {
      if (visible) void this.refreshCacheStats();
    },
  },
  mounted() {
    if (this.modelValue) void this.refreshCacheStats();
  },
  methods: {

    /** 统一走 store 的 update（会由主进程广播回写，保证与其它窗口一致） */
    set<K extends keyof AppSetting>(key: K, value: AppSetting[K]): void {
      void this.store.update({ [key]: value } as Partial<AppSetting>);
    },
    /**
     * 开关类控件
     *
     * element-plus 的 el-switch 回调签名是 `string | number | boolean`（它支持自定义值），
     * 所以这里在方法里收窄成 boolean，避免模板里塞一堆断言。
     */
    setBool(
      key: 'player.resumeOnStart' | 'player.resumePlaybackTime' | 'common.wallpaperMode',
      v: string | number | boolean,
    ): void {
      this.set(key, Boolean(v));
    },
    async clearCache() {
      this.cacheBusy = true;
      try {
        await api.clearCache();
        await this.refreshCacheStats();
        ElMessage.success('缓存已清除');
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err));
      } finally {
        this.cacheBusy = false;
      }
    },
    /** 手动触发一次「过期 + LRU」清理 */
    async pruneCache() {
      this.cacheBusy = true;
      try {
        const stats = await api.pruneCache();
        this.cacheStats = stats;
        ElMessage.success(`清理完成，当前 ${stats.count} 个文件 / ${formatBytes(stats.bytes)}`);
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err));
      } finally {
        this.cacheBusy = false;
      }
    },
    async refreshCacheStats() {
      try {
        this.cacheStats = await api.getCacheStats();
      } catch {
        /* 拿不到统计不影响设置界面 */
      }
    },
    async resetAll() {
      try {
        await this.store.reset();
        ElMessage.success('已恢复默认设置');
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err));
      }
    },
  },
});
</script>

<style scoped>
.st-body {
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}
.st-group {
  margin-bottom: 18px;
}
.st-group-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.55;
  margin-bottom: 6px;
  padding-left: 2px;
}
.st-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 2px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.14);
}
.st-row:last-child {
  border-bottom: none;
}
.st-label {
  min-width: 0;
}
.st-name {
  font-size: 13px;
}
.st-desc {
  font-size: 11px;
  opacity: 0.55;
  margin-top: 2px;
  line-height: 1.5;
}
.st-note {
  font-size: 11px;
  opacity: 0.45;
  line-height: 1.6;
  padding: 8px 2px 0;
}
.st-actions {
  display: flex;
  gap: 6px;
  flex: none;
}
</style>
