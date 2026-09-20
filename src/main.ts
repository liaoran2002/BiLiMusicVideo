import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import './assets/iconfont/iconfont.css'
import { useSettingStore } from './stores/setting'

const app = createApp(App)

app.use(createPinia())
app.use(ElementPlus)

/**
 * 启动前先把主进程的配置拉进 Pinia，并挂上 setting:update 广播监听。
 *
 * 这样组件 mounted 时 store 已经就绪，
 * 不会出现「首帧用默认值、下一帧才跳成真实值」的闪烁。
 */
const bootstrap = async (): Promise<void> => {
  const settingStore = useSettingStore()
  // 先挂监听再拉取：避免拉取与广播之间的竞态导致丢更新
  settingStore.startSync()
  try {
    await settingStore.load()
  } catch (err) {
    console.error('[bootstrap] load setting failed, fallback to defaults:', err)
  }
  app.mount('#app')
}

void bootstrap()
