/**
 * 歌单集合服务（主进程）
 *
 * 从原来的「单个 playlist.json」升级为「多歌单 + 自动同步」：
 *  - playlists.json 保存整个集合（含每个歌单的同步策略与播放位置）
 *  - 旧版 playlist.json 会在首次启动时自动迁移成一条记录，不丢数据
 *  - 与 setting 服务一致：内存常驻 + 防抖落盘
 *
 * 自动同步只负责「重新解析歌单曲目」；把歌曲匹配成 B 站视频是渲染进程的事，
 * 所以同步结果（新增/移除曲目）返回给渲染进程处理。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PLAYLIST_DATA_VERSION, STORE_NAMES } from '@common/constants'
import type {
  DuplicatePolicy,
  PlaylistRecord,
  PlaylistSaveParams,
  PlaylistSong,
  PlaylistStoreData,
  SyncResult,
} from '@common/types/playlist'
import { parseSearchKey, toSearchKey } from '@common/types/playlist'
import { debounce } from '@common/utils/common'
import { getStore } from './store'
import { resolvePlaylist } from '../music'

const WRITE_DEBOUNCE_MS = 300
/** 自动同步时最多处理多少首歌（防御异常巨大的歌单） */
const MAX_SYNC_SONGS = 2000

const emptyData = (): PlaylistStoreData => ({
  version: PLAYLIST_DATA_VERSION,
  currentId: null,
  playlists: [],
})

let data: PlaylistStoreData = emptyData()
let store: ReturnType<typeof getStore<PlaylistStoreData & Record<string, unknown>>> | null = null

const getNewPlaylistPath = (): string =>
  path.join(app.getPath('userData'), `${STORE_NAMES.PLAYLISTS}.json`)
/** 旧版单歌单文件（本项目 ≤1.5.x 一直在用） */
const getLegacyPlaylistPath = (): string =>
  path.join(app.getPath('userData'), `${STORE_NAMES.PLAYLIST}.json`)

/** 落盘 */
const writeToDisk = (): void => {
  if (!store) return
  store.override(data as unknown as PlaylistStoreData & Record<string, unknown>)
}
const writeDebounced = debounce(writeToDisk, WRITE_DEBOUNCE_MS)

/** 立即落盘（退出前调用） */
export const flushPlaylists = (): void => {
  writeDebounced.flush()
}

/** 生成一个歌单 id */
const newId = (): string => randomUUID()

/**
 * 把旧的单歌单文件迁移成集合里的第一条记录
 *
 * 旧结构：{ name: string, songs: string[] }
 */
const migrateLegacy = (): PlaylistRecord | null => {
  const legacyPath = getLegacyPlaylistPath()
  if (!fs.existsSync(legacyPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf8')) as {
      name?: string
      songs?: string[]
    }
    if (!Array.isArray(raw.songs) || raw.songs.length === 0) return null
    const now = Date.now()
    const record: PlaylistRecord = {
      id: newId(),
      name: raw.name || '我的歌单',
      songs: normalizeSongs(raw.songs),
      sync: { mode: 'off', intervalMs: 0 },
      lastSyncAt: now,
      createdAt: now,
      updatedAt: now,
      lastIndex: 0,
      videoCache: {},
    }
    // 迁移成功后把旧文件改名备份，避免重复迁移
    try {
      fs.renameSync(legacyPath, `${legacyPath}.migrated`)
    } catch {
      /* 备份失败不影响迁移结果 */
    }
    console.log(`[playlist] 已迁移旧歌单《${record.name}》，共 ${record.songs.length} 首`)
    return record
  } catch (err) {
    console.error('[playlist] 迁移旧歌单失败:', err)
    return null
  }
}

/**
 * 归一化歌曲数组
 *
 * 兼容两种磁盘格式：
 *  - 旧版 `["歌名-歌手", ...]` 字符串数组 → 解析成结构化对象（不丢数据）
 *  - 新版 `[{name, singer, album, cover, duration}, ...]`
 */
const normalizeSongs = (input: unknown): PlaylistSong[] => {
  if (!Array.isArray(input)) return []
  const result: PlaylistSong[] = []
  for (const item of input) {
    if (typeof item === 'string') {
      const parsed = parseSearchKey(item)
      if (parsed.name) result.push(parsed)
      continue
    }
    if (item && typeof item === 'object') {
      const raw = item as Partial<PlaylistSong>
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      if (!name) continue
      result.push({
        name,
        singer: typeof raw.singer === 'string' ? raw.singer : '',
        album: typeof raw.album === 'string' && raw.album ? raw.album : undefined,
        cover: typeof raw.cover === 'string' && raw.cover ? raw.cover : null,
        duration:
          typeof raw.duration === 'string' && raw.duration ? raw.duration : null,
      })
    }
  }
  return result
}

/** 归一化一条记录，补齐缺省字段（磁盘上的旧数据可能缺项） */
const normalizeRecord = (input: Partial<PlaylistRecord>): PlaylistRecord | null => {
  if (!input || typeof input !== 'object') return null
  if (!Array.isArray(input.songs)) return null
  const now = Date.now()
  return {
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    name: typeof input.name === 'string' && input.name ? input.name : '未命名歌单',
    source: typeof input.source === 'string' ? input.source : undefined,
    sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl : undefined,
    songs: normalizeSongs(input.songs),
    sync: {
      mode:
        input.sync?.mode === 'startup' || input.sync?.mode === 'interval'
          ? input.sync.mode
          : 'off',
      intervalMs:
        typeof input.sync?.intervalMs === 'number' && input.sync.intervalMs > 0
          ? input.sync.intervalMs
          : 0,
    },
    lastSyncAt: typeof input.lastSyncAt === 'number' ? input.lastSyncAt : null,
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : now,
    lastIndex:
      typeof input.lastIndex === 'number' && input.lastIndex >= 0 ? input.lastIndex : 0,
    videoCache:
      input.videoCache && typeof input.videoCache === 'object' ? input.videoCache : {},
  }
}

/** 初始化（app.whenReady 之后调用） */
export const initPlaylists = (): void => {
  const filePath = getNewPlaylistPath()
  store = getStore<PlaylistStoreData & Record<string, unknown>>(filePath)

  const raw = store.get('playlists')
  let loaded: PlaylistRecord[] = []
  if (Array.isArray(raw)) {
    loaded = raw
      .map((item) => normalizeRecord(item as Partial<PlaylistRecord>))
      .filter((item): item is PlaylistRecord => item !== null)
  }

  let currentId = store.get('currentId')
  if (typeof currentId !== 'string') currentId = null

  let needSave = false
  if (loaded.length === 0) {
    const migrated = migrateLegacy()
    if (migrated) {
      loaded = [migrated]
      currentId = migrated.id
      needSave = true
    }
  }
  if (loaded.length > 0 && !loaded.some((p) => p.id === currentId)) {
    currentId = loaded[0].id
    needSave = true
  }

  /**
   * 一次性升级：把「有分享链接但仍处于手动同步」的歌单改成启动同步
   *
   * 背景：同步策略原先有一半由全局设置（playlist.syncOnStartup）控制，
   * 现在改成完全由每个歌单自己决定。如果不做这一步，老用户那些
   * mode === 'off' 的歌单会突然完全不再自动同步。
   */
  const upgraded = loaded.filter((p) => p.sourceUrl && p.sync.mode === 'off')
  if (upgraded.length > 0) {
    for (const p of upgraded) {
      p.sync = { mode: 'startup', intervalMs: 0 }
      p.updatedAt = Date.now()
    }
    needSave = true
    console.log(
      `[playlist] 已将 ${upgraded.length} 个有链接的歌单升级为「启动同步」：` +
        upgraded.map((p) => p.name).join('、'),
    )
  }

  data = { version: PLAYLIST_DATA_VERSION, currentId, playlists: loaded }
  if (needSave) writeToDisk()
  console.log(`[playlist] 已加载 ${loaded.length} 个歌单，当前=${currentId ?? '无'}`)
}

/** 取完整集合（深拷贝，避免调用方改到内存里那份） */
export const getPlaylists = (): PlaylistStoreData => structuredClone(data)

/** 整体覆盖保存（渲染进程每次增删改后调用） */
export const savePlaylists = (params: PlaylistSaveParams): PlaylistStoreData => {
  const normalized: PlaylistRecord[] = []
  if (Array.isArray(params?.playlists)) {
    for (const item of params.playlists) {
      const record = normalizeRecord(item)
      if (record) normalized.push(record)
    }
  }
  let currentId =
    typeof params?.currentId === 'string' && params.currentId ? params.currentId : null
  if (normalized.length > 0 && !normalized.some((p) => p.id === currentId)) {
    currentId = normalized[0].id
  }
  if (normalized.length === 0) currentId = null

  data = { version: PLAYLIST_DATA_VERSION, currentId, playlists: normalized }
  writeDebounced()
  return structuredClone(data)
}

/** 去重用的归一化 key */
const songKey = (song: PlaylistSong): string =>
  toSearchKey(song).trim().toLowerCase()

/**
 * 同步一个歌单（重新解析曲目）
 *
 * @returns 同步结果，其中 added/removed 供界面提示
 */
export const syncPlaylist = async (
  id: string,
  duplicatePolicy: DuplicatePolicy = 'dedupe',
): Promise<SyncResult> => {
  const index = data.playlists.findIndex((p) => p.id === id)
  if (index < 0) return { id, name: '', ok: false, error: '歌单不存在' }

  const target = data.playlists[index]
  if (!target.sourceUrl) {
    return {
      id,
      name: target.name,
      ok: false,
      error: '该歌单没有保存原始链接，无法自动同步（请重新添加）',
    }
  }

  try {
    const detail = await resolvePlaylist({ input: target.sourceUrl })
    // 直接保留结构化字段（封面/专辑/歌手/时长），不再压成字符串
    let songs: PlaylistSong[] = detail.songs.map((song) => ({
      name: song.name,
      singer: song.singer,
      album: song.albumName,
      cover: song.cover ?? null,
      duration: song.interval,
    }))
    if (songs.length > MAX_SYNC_SONGS) songs = songs.slice(0, MAX_SYNC_SONGS)

    if (duplicatePolicy === 'dedupe') {
      const seen = new Set<string>()
      songs = songs.filter((song) => {
        const key = songKey(song)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    const before = new Set(target.songs.map(toSearchKey))
    const after = new Set(songs.map(toSearchKey))
    const added = songs.filter((s) => !before.has(toSearchKey(s))).length
    const removed = target.songs.filter((s) => !after.has(toSearchKey(s))).length

    // 名称与来源以远端为准，但保留用户自定义的名字（仅当原名为空时更新）
    if (!target.name.trim()) target.name = detail.info.name || target.name
    target.source = detail.source
    target.songs = songs
    target.lastSyncAt = Date.now()
    target.updatedAt = Date.now()
    // 曲目数变化可能让下标越界
    if (target.lastIndex >= songs.length) target.lastIndex = 0

    // 清掉已不存在歌曲的缓存（videoCache 的 key 是搜索键，不是下标）
    if (target.videoCache) {
      const valid = new Set(songs.map(toSearchKey))
      for (const key of Object.keys(target.videoCache)) {
        if (!valid.has(key)) delete target.videoCache[key]
      }
    }

    writeDebounced()
    return { id, name: target.name, ok: true, count: songs.length, added, removed }
  } catch (err) {
    target.updatedAt = Date.now()
    writeDebounced()
    return {
      id,
      name: target.name,
      ok: false,
      error: (err as Error)?.message ?? '同步失败',
    }
  }
}

/**
 * 同步多个歌单
 *
 * 串行执行，避免同时打多个平台的接口被限流。
 */
export const syncPlaylists = async (
  ids: string[],
  duplicatePolicy: DuplicatePolicy = 'dedupe',
): Promise<SyncResult[]> => {
  const results: SyncResult[] = []
  for (const id of ids) {
    results.push(await syncPlaylist(id, duplicatePolicy))
  }
  return results
}
