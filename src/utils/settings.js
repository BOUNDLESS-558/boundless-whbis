/**
 * 全局设置中心（纯本地存储 · 按设备生效，不依赖后端）
 *
 * - 皮肤：黑色 / 白色 / 跟随系统。H5 下把解析结果写到 <html data-skin="…">，
 *   全局 CSS（App.vue）据此换肤；「跟随系统」监听 prefers-color-scheme 变化即时跟随。
 * - 全局默认刷新间隔：手动(0) / 15 / 30 / 45 / 60 秒。实时线路 / 实时车辆在用户没手动选过
 *   间隔时采用该默认值（各视图里手动选过的间隔仍然优先，互不覆盖）。
 * - 用户名（展示名）：按账号本地保存，仅改显示不改登录身份；账号名不可修改。
 * - 登录有效期：会话本体在 auth.js，这里原样转出 get/setSessionDays。
 */
import { normAccount, getSessionDays, setSessionDays } from './auth.js'

export { getSessionDays, setSessionDays }

const SKIN_KEY = 'whbis:skin'
const REFRESH_KEY = 'whbis:refresh-default'
const PROFILE_KEY = 'whbis:profile'

export const SKIN_OPTS = [
  { key: 'dark', label: '黑色' },
  { key: 'light', label: '白色' },
  { key: 'auto', label: '跟随系统' },
]
// 0 = 手动刷新（不自动轮询，仅用户下拉/点刷新时拉取）
export const REFRESH_DEFAULT_OPTS = [0, 15, 30, 45, 60]

function readRaw(key, fallback) {
  try {
    const v = uni.getStorageSync(key)
    return v === '' || v == null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function writeRaw(key, v) {
  try {
    uni.setStorageSync(key, v)
  } catch (e) { /* 存储不可用时仅本次生效 */ }
}

// ── 皮肤 ──

export function getSkin() {
  const v = readRaw(SKIN_KEY, 'dark')
  return SKIN_OPTS.some((o) => o.key === v) ? v : 'dark'
}

/** 解析后的实际皮肤：auto 按 prefers-color-scheme 落到 dark/light */
export function resolvedSkin() {
  const s = getSkin()
  if (s !== 'auto') return s
  // #ifdef H5
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch (e) { /* 匹配不了就按深色 */ }
  // #endif
  return 'dark'
}

/** 把当前皮肤应用到文档根节点（App.vue 的全局 CSS 据此换肤） */
export function applySkin() {
  // #ifdef H5
  try {
    document.documentElement.dataset.skin = resolvedSkin()
  } catch (e) { /* 忽略 */ }
  // #endif
}

let _watching = false
/** 「跟随系统」：监听系统深浅色切换，auto 档下即时重应用（整个生命周期只挂一次） */
export function watchSystemSkin() {
  // #ifdef H5
  if (_watching || typeof window === 'undefined' || !window.matchMedia) return
  _watching = true
  try {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const h = () => {
      if (getSkin() === 'auto') applySkin()
    }
    if (mq.addEventListener) mq.addEventListener('change', h)
    else if (mq.addListener) mq.addListener(h)
  } catch (e) { /* 忽略 */ }
  // #endif
}

export function setSkin(skin) {
  if (SKIN_OPTS.some((o) => o.key === skin)) {
    writeRaw(SKIN_KEY, skin)
    applySkin()
  }
  return getSkin()
}

// ── 全局默认刷新间隔（秒）──

export function getRefreshDefault() {
  const v = Number(readRaw(REFRESH_KEY, 15))
  return REFRESH_DEFAULT_OPTS.includes(v) ? v : 15
}

export function setRefreshDefault(sec) {
  const v = REFRESH_DEFAULT_OPTS.includes(Number(sec)) ? Number(sec) : 15
  writeRaw(REFRESH_KEY, v)
  return v
}

// ── 用户名（展示名）：账号名是登录主键不可改，用户名只是本地展示层 ──

function readProfile() {
  let v
  try {
    v = uni.getStorageSync(PROFILE_KEY)
  } catch (e) {
    return {}
  }
  if (!v) return {}
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch (e) { return {} }
  }
  return v && typeof v === 'object' ? v : {}
}

/** 该账号的用户名；未设置返回 ''（UI 回退显示账号名） */
export function getDisplayName(account) {
  const row = readProfile()[normAccount(account)]
  return (row && row.name) || ''
}

/** 保存用户名（trim 后最多 16 字；传空即清除，回退显示账号名） */
export function setDisplayName(account, name) {
  const n = String(name == null ? '' : name).trim().slice(0, 16)
  const k = normAccount(account)
  if (!k) return ''
  const p = readProfile()
  if (n) p[k] = { ...(p[k] || {}), name: n }
  else if (p[k]) {
    delete p[k].name
    if (!Object.keys(p[k]).length) delete p[k]
  }
  writeRaw(PROFILE_KEY, p)
  return n
}
