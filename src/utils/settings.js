/**
 * 全局设置中心（纯本地存储 · 按设备生效，不依赖后端）
 *
 * - 皮肤：黑色 / 白色 / 跟随系统。H5 下把解析结果写到 <html data-skin="…">，
 *   全局 CSS（App.vue）据此换肤；「跟随系统」监听 prefers-color-scheme 变化即时跟随。
 * - 刷新间隔：手动(0) / 15 / 20 / 30 秒，全站唯一真源（whbis:refresh-default）。
 *   实时线路、地图页、极简站牌、账号与设置里的刷新控件都读写这一份值，
 *   任意一处改动经 onRefreshSecChange 订阅即时同步到其余控件。
 * - 主题色（强调色）：预设色板 + 调色盘自定义。派生出 --ac / --ac-hi / --ac-deep / --ac-text /
 *   --ac-2 / --ac-rgb / --ac2-rgb 一族 CSS 变量挂 <html>，全站按钮 / 页签 / 选中态跟随变色；
 *   默认靛蓝与历史配色逐像素一致。H5 生效（App 端保持默认）。
 * - 用户名（展示名）：按账号本地保存，仅改显示不改登录身份；账号名不可修改。
 * - 登录有效期：会话本体在 auth.js，这里原样转出 get/setSessionDays。
 * - 地图来源：高德（免 Key 标准瓦片）。GCJ-02 栅格，与公交接口同源零纠偏；
 *   仅影响底图，线路轨迹规划仍走高德 Web 服务。
 * - 高德地图 KEY：用户自填 Web端(JS API) Key，自绘模式下拉官方公交真实轨迹让走向更精确；
 *   留空走免 Key 的 OSRM 贴路。
 */
import { normAccount, getSessionDays, setSessionDays } from './auth.js'

export { getSessionDays, setSessionDays }

const SKIN_KEY = 'whbis:skin'
const ACCENT_KEY = 'whbis:accent'
const REFRESH_KEY = 'whbis:refresh-default'
const PROFILE_KEY = 'whbis:profile'
// 复制方式：所有「复制」按钮统一按此档执行（文本 TSV / 画成图片 / Excel 表格）
const COPY_MODE_KEY = 'whbis:copy-mode'

export const SKIN_OPTS = [
  { key: 'dark', label: '黑色' },
  { key: 'light', label: '白色' },
  { key: 'auto', label: '跟随系统' },
]
// 0 = 手动刷新（不自动轮询，仅用户下拉/点刷新时拉取）
// 全站统一档位：设置面板分段 + 各视图下拉共用，避免各存一份造成「设置不同步」
export const REFRESH_DEFAULT_OPTS = [0, 15, 20, 30]
// 下拉统一文案（label / tip），所有刷新胶囊共用一份
export const REFRESH_OPTS = [
  { sec: 0, label: '手动刷新', tip: '点 ↻ 才拉取' },
  { sec: 15, label: '15 秒', tip: '最灵敏' },
  { sec: 20, label: '20 秒', tip: '较灵敏' },
  { sec: 30, label: '30 秒', tip: '省流量' },
]

// ── 主题色（强调色）──

export const DEFAULT_ACCENT = '#6366f1'
// 预设色板：避开上行青蓝 #06B6D4 与下行玫红 #F43F5E（方向配色专用，别让主题色撞上去）
export const ACCENT_PRESETS = [
  { key: 'indigo', hex: '#6366f1', label: '靛蓝' },
  { key: 'purple', hex: '#a855f7', label: '紫罗兰' },
  { key: 'magenta', hex: '#ec4899', label: '洋红' },
  { key: 'green', hex: '#10b981', label: '翠绿' },
  { key: 'orange', hex: '#f97316', label: '活力橙' },
  { key: 'blue', hex: '#3b82f6', label: '天蓝' },
]

/** 规范成 #rrggbb 小写；非法输入返回 null */
function normHex(v) {
  let s = String(v == null ? '' : v).trim().toLowerCase()
  if (s.charAt(0) !== '#') s = '#' + s
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
  return /^#[0-9a-f]{6}$/.test(s) ? s : null
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  let h = 0
  let s = 0
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, s * 100, l * 100]
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0; let g = 0; let b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c } else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c } else if (h < 300) { r = x; b = c } else { r = c; b = x }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return '#' + to(r) + to(g) + to(b)
}

/**
 * 由基准色派生全站强调色变量族：
 * - ac 基准 / hi 提亮（浅文字、描边）/ deep 压暗（hover、渐变深端）/ text 浅色文字
 * - ac2 渐变搭档色（基准色相 -52°，默认靛蓝恰好落在历史用的青色端）
 * - rgb / rgb2 供 rgba(var(--ac-rgb), α) 写法
 * 默认靛蓝直接返回历史常量，保证与既有视觉逐像素一致。
 */
export function accentScale(hex) {
  const base = normHex(hex) || DEFAULT_ACCENT
  if (base === DEFAULT_ACCENT) {
    return {
      ac: '#6366f1', hi: '#818cf8', deep: '#4f46e5', text: '#c7d2fe',
      ac2: '#06b6d4', rgb: '99, 102, 241', rgb2: '6, 182, 212',
    }
  }
  const [h, s, l] = rgbToHsl(...hexToRgb(base))
  const cl = (v, lo, hi2) => Math.max(lo, Math.min(hi2, v))
  const h2 = (h + 308) % 360 // -52°：冷色系搭档（靛蓝→青），暖色系也得带邻近过渡的渐变端
  return {
    ac: base,
    hi: hslToHex(h, s, cl(l + 8, 60, 92)),
    deep: hslToHex(h, cl(s - 4, 30, 100), cl(l - 12, 28, 60)),
    text: hslToHex(h, s, cl(l + 21, 70, 90)),
    ac2: hslToHex(h2, s, cl(l, 35, 70)),
    rgb: hexToRgb(base).join(', '),
    rgb2: hexToRgb(hslToHex(h2, s, cl(l, 35, 70))).join(', '),
  }
}

export function getAccent() {
  return normHex(readRaw(ACCENT_KEY, DEFAULT_ACCENT)) || DEFAULT_ACCENT
}

/** 把主题色变量族应用到 <html>（App.vue 全局 CSS 与各组件 var() 据此变色） */
export function applyAccent(hex) {
  // #ifdef H5
  try {
    const sc = accentScale(hex)
    const st = document.documentElement.style
    st.setProperty('--ac', sc.ac)
    st.setProperty('--ac-hi', sc.hi)
    st.setProperty('--ac-deep', sc.deep)
    st.setProperty('--ac-text', sc.text)
    st.setProperty('--ac-2', sc.ac2)
    st.setProperty('--ac-rgb', sc.rgb)
    st.setProperty('--ac2-rgb', sc.rgb2)
  } catch (e) { /* 忽略 */ }
  // #endif
}

/** 落库 + 应用，返回生效色 */
export function setAccent(hex) {
  const n = normHex(hex)
  if (n) {
    writeRaw(ACCENT_KEY, n)
    applyAccent(n)
  }
  return getAccent()
}

/** 仅应用不落库（调色盘拖动时的实时预览；cancel 时回退也走它） */
export function previewAccent(hex) {
  applyAccent(hex)
}

/** JS 侧取主题色 rgba 字符串（marker 标签底色等 CSS 变量够不到的场景） */
export function accentRgba(alpha) {
  const [r, g, b] = hexToRgb(getAccent())
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
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

// ── 刷新间隔（秒）：全站唯一真源 ──
// 旧版「实时线路 / 地图页各存一份」会让同一份设置在不同按钮上显示不同值，且设置面板
// 改了默认值后已手动选过的视图不跟随。现在统一读写 REFRESH_KEY，并广播给所有订阅者。
const _refreshListeners = new Set()
// 旧键：首次读取时迁移到真源；setRefreshSec 也会镜像写，兼容仍在读旧键的探针/旧代码
const LEGACY_REFRESH_KEYS = ['whbis:line-refresh-sec', 'whbis:map-refresh-sec']

function normalizeRefreshSec(sec) {
  const v = Number(sec)
  return REFRESH_DEFAULT_OPTS.includes(v) ? v : 15
}

export function getRefreshSec() {
  const raw = readRaw(REFRESH_KEY, '')
  if (raw !== '' && raw != null) return normalizeRefreshSec(raw)
  // 真源没写过 → 从旧键做一次性迁移，命中即写回真源（旧键保留，便于回滚）
  for (const key of LEGACY_REFRESH_KEYS) {
    const old = readRaw(key, '')
    if (old !== '' && old != null) {
      const v = normalizeRefreshSec(old)
      writeRaw(REFRESH_KEY, v)
      return v
    }
  }
  return 15
}

export function setRefreshSec(sec) {
  const v = normalizeRefreshSec(sec)
  writeRaw(REFRESH_KEY, v)
  LEGACY_REFRESH_KEYS.forEach((key) => writeRaw(key, v))
  _refreshListeners.forEach((cb) => {
    try { cb(v) } catch (e) { /* 单个订阅者异常不影响其它控件 */ }
  })
  return v
}

// 订阅刷新间隔变化，返回取消订阅函数（组件卸载时调用，避免泄漏）
export function onRefreshSecChange(cb) {
  if (typeof cb !== 'function') return () => {}
  _refreshListeners.add(cb)
  return () => _refreshListeners.delete(cb)
}

// 兼容旧命名：语义已从「各视图的默认值」升级为「全站统一值」
export const getRefreshDefault = getRefreshSec
export const setRefreshDefault = setRefreshSec

// ── 复制方式（全站统一）──
// text = TSV 纯文本；image = PNG 图片（页脚带生成时间）；
// excel = HTML <table> 写进剪贴板，粘贴到 Excel / WPS 直接是可编辑表格（H5 安全上下文）
// 没有设置面板入口：档位就在每个复制胶囊（components/CopyPill.vue）右半的下拉里，
// 任一处切换经 onCopyModeChange 广播，其余胶囊即时跟随。
// 顺序即下拉里的排列：纯文本 → Excel → 图片（由轻到重）。
// short 用于复制胶囊右半的档位标签（一行放得下），label 用于下拉与提示。
export const COPY_MODE_OPTS = [
  { key: 'text', label: '复制为纯文本', short: '文本', note: 'TSV 表格，可粘进 Excel' },
  { key: 'excel', label: '复制为 Excel', short: 'Excel', note: '带样式表格，粘到 Excel / WPS 即可编辑' },
  { key: 'image', label: '复制为图片', short: '图片', note: 'PNG 图片，带生成时间，可直接粘贴发送' },
]

function normalizeCopyMode(v) {
  return COPY_MODE_OPTS.some((o) => o.key === v) ? v : 'text'
}

export function getCopyMode() {
  return normalizeCopyMode(readRaw(COPY_MODE_KEY, 'text'))
}

// 订阅者：全站每个复制胶囊都挂一个，任一处切换档位，其余按钮的档位标签即时跟随
const _copyListeners = new Set()

export function setCopyMode(key) {
  const v = normalizeCopyMode(key)
  writeRaw(COPY_MODE_KEY, v)
  _copyListeners.forEach((cb) => {
    try { cb(v) } catch (e) { /* 单个订阅者异常不影响其它控件 */ }
  })
  return v
}

// 订阅复制方式变化，返回取消订阅函数（组件卸载时调用，避免泄漏）
export function onCopyModeChange(cb) {
  if (typeof cb !== 'function') return () => {}
  _copyListeners.add(cb)
  return () => _copyListeners.delete(cb)
}

// 说明：非集团线路（蔡城 / 木兰 / 汉奇）已并入全站线路库，默认全部可查询搜索，
// 不再提供「其它公交公司」开关；相关存储键与设置订阅机制已移除。

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

// ── 界面字体 ──
// 内置多款「OFL / 免费商用」开源字体，webfont 按需分片加载：
// CSS 用 unicode-range 把整字库切成上百个小 woff2，浏览器只下载页面实际
// 用到的字形分片（首屏通常几十 KB），不用的字重/生僻字一分都不拉。
// 全部走 jsDelivr CDN；加载失败时 family 栈会回退到系统字体，UI 永远可读。
// 仅 H5 生效（App 端保持系统默认，与主题色的平台约束一致）。

const FONT_KEY = 'whbis:ui-font'

/** 默认档 key 与历史系统字体栈（App.vue page 的 font-family 与它逐字一致） */
export const DEFAULT_FONT = 'system'
export const BASE_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', " +
  "'Source Han Sans CN', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', Roboto, " +
  'Helvetica, Arial, sans-serif'

const FS5 = 'https://cdn.jsdelivr.net/npm/@fontsource/'
const LGW = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/'
const LGW_LITE = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-lite-webfont@1.6.0/'
const LGW_SCREEN = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.6.0/'
// 厂商免费商用字体（小米 MiSans / 华为 HarmonyOS Sans），同样是 unicode-range 分片
const MISANS = 'https://cdn.jsdelivr.net/npm/misans@5.0.0/lib/Normal/'
const HARMONY = 'https://cdn.jsdelivr.net/npm/harmonyos-sans-sc-webfont-splitted@1.1.0/dist/'
// cn-fontsource 系列：社区把免费商用字体切成分片 woff2，单包只含一个 font.css
const CNFS = 'https://cdn.jsdelivr.net/npm/'

/**
 * 字体档位：css 为需要注入的 <link> 列表；family 为该字体在 CSS 里的 font-family 名。
 * 排序按「日常可用度」：系统默认 → 正文字体（黑/宋/楷）→ 圆体 → 书法展示体。
 * 全部 SIL OFL / 厂商免费商用；CSS 均为 unicode-range 分片，只下载页面用到的字形。
 */
export const FONT_OPTS = [
  { key: 'system', label: '系统默认', note: '跟随系统 · 零加载', family: '', css: [] },
  {
    key: 'wenkai', label: '霞鹜文楷', note: '楷体 · 温润易读', family: "'LXGW WenKai'",
    css: [LGW + 'lxgwwenkai-regular.css', LGW + 'lxgwwenkai-bold.css'],
  },
  {
    key: 'wenkai-screen', label: '霞鹜文楷·屏显', note: '加粗优化 · 更适合屏幕', family: "'LXGW WenKai Screen'",
    css: [LGW_SCREEN + 'lxgwwenkaiscreen.css', LGW_SCREEN + 'lxgwwenkaiscreenr.css'],
  },
  {
    key: 'wenkai-lite', label: '霞鹜文楷·精简', note: '轻量版 · 加载更快', family: "'LXGW WenKai Lite'",
    css: [LGW_LITE + 'lxgwwenkailite-regular.css', LGW_LITE + 'lxgwwenkailite-bold.css'],
  },
  {
    key: 'noto-sans', label: '思源黑体', note: '现代黑体 · 端正', family: "'Noto Sans SC'",
    css: [FS5 + 'noto-sans-sc@5.1.0/400.css', FS5 + 'noto-sans-sc@5.1.0/500.css', FS5 + 'noto-sans-sc@5.1.0/700.css'],
  },
  {
    key: 'noto-serif', label: '思源宋体', note: '衬线宋体 · 文艺', family: "'Noto Serif SC'",
    css: [FS5 + 'noto-serif-sc@5.1.0/400.css', FS5 + 'noto-serif-sc@5.1.0/700.css'],
  },
  {
    key: 'misans', label: 'MiSans 小米', note: '现代黑体 · 大气', family: "'MiSans'",
    css: [MISANS + 'MiSans-Regular.min.css', MISANS + 'MiSans-Medium.min.css', MISANS + 'MiSans-Bold.min.css'],
  },
  {
    key: 'harmony', label: '鸿蒙黑体', note: 'HarmonyOS · 科技感', family: "'HarmonyOS Sans SC'",
    css: [HARMONY + 'Regular.css', HARMONY + 'Medium.css', HARMONY + 'Bold.css'],
  },
  {
    key: 'neo-xihei', label: '霞鹜新晰黑', note: '屏幕黑体 · 清晰大气', family: "'LXGW Neo XiHei'",
    css: [CNFS + 'cn-fontsource-lxgw-neo-xi-hei-regular@1.0.1/font.css'],
  },
  {
    key: 'xiaowei', label: '站酷小薇体', note: '复古宋体 · 秀气', family: "'ZCOOL XiaoWei'",
    css: [FS5 + 'zcool-xiaowei@5.1.0/400.css'],
  },
  {
    key: 'qingke', label: '站酷庆科黄油体', note: '圆润粗体 · 标题感', family: "'ZCOOL QingKe HuangYou'",
    css: [FS5 + 'zcool-qingke-huangyou@5.1.0/400.css'],
  },
  {
    key: 'kuaile', label: '站酷快乐体', note: '圆润手写 · 活泼', family: "'ZCOOL KuaiLe'",
    css: [FS5 + 'zcool-kuaile@5.1.0/400.css'],
  },
  {
    key: 'mashan', label: '马善政楷书', note: '毛笔楷书 · 飘逸', family: "'Ma Shan Zheng'",
    css: [FS5 + 'ma-shan-zheng@5.1.0/400.css'],
  },
  {
    key: 'longcang', label: '龙藏体', note: '行书手写 · 洒脱', family: "'Long Cang'",
    css: [FS5 + 'long-cang@5.1.0/400.css'],
  },
  {
    key: 'zhimang', label: '志莽行书', note: '行草 · 洒脱奔放', family: "'Zhi Mang Xing'",
    css: [FS5 + 'zhi-mang-xing@5.1.0/400.css'],
  },
  {
    key: 'liujian', label: '柳建毛草', note: '草书 · 写意', family: "'Liu Jian Mao Cao'",
    css: [FS5 + 'liu-jian-mao-cao@5.1.0/400.css'],
  },
  {
    key: 'smiley', label: '得意黑', note: '潮流标题 · 动感', family: "'Smiley Sans Oblique'",
    css: [CNFS + 'cn-fontsource-smiley-sans-oblique-regular@1.0.1/font.css'],
  },
  {
    key: 'dingtalk', label: '钉钉进步体', note: '标题感 · 现代', family: "'DingTalk JinBuTi'",
    css: [CNFS + 'cn-fontsource-ding-talk-jin-bu-ti-regular@1.0.3/font.css'],
  },
]

export function getFont() {
  const v = readRaw(FONT_KEY, DEFAULT_FONT)
  return FONT_OPTS.some((o) => o.key === v) ? v : DEFAULT_FONT
}

/**
 * 当前字体的完整 family 栈（与 applyFont 写入 --app-font 的值逐字一致）。
 * 供 canvas 绘制（复制图片）复用，保证图片字体与界面「账号与设置 → 界面字体」完全一致。
 * @param {string} [key] 指定档位；不传则取当前生效档
 */
export function getFontFamily(key) {
  const opt = FONT_OPTS.find((o) => o.key === (key || getFont())) || FONT_OPTS[0]
  return opt.family ? `${opt.family}, ${BASE_FONT_STACK}` : BASE_FONT_STACK
}

/** 幂等注入一个 <link rel=stylesheet>（同一 URL 只注一次，重复调用零开销） */
function injectCss(url) {
  const ID = 'whbis-font-css'
  const host = document.getElementById(ID) || (() => {
    const h = document.createElement('div')
    h.id = ID
    h.style.display = 'none'
    document.head.appendChild(h)
    return h
  })()
  if (host.querySelector(`link[data-h="${cssKey(url)}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  link.dataset.h = cssKey(url)
  host.appendChild(link)
}

/** URL → 稳定短 id（data 属性不能用任意字符，取个简单 hash） */
function cssKey(url) {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0
  return 'f' + h.toString(36)
}

/** 把字体档位应用到 <html>：注入所需 CSS + 写 --app-font 变量（App.vue 的 page 据此生效） */
export function applyFont(key) {
  // #ifdef H5
  try {
    const opt = FONT_OPTS.find((o) => o.key === (key || getFont())) || FONT_OPTS[0]
    opt.css.forEach(injectCss)
    document.documentElement.style.setProperty('--app-font', getFontFamily(key))
  } catch (e) { /* 忽略 */ }
  // #endif
}

/** 落库 + 应用，返回生效档 key */
export function setFont(key) {
  if (FONT_OPTS.some((o) => o.key === key)) {
    writeRaw(FONT_KEY, key)
    applyFont(key)
  }
  return getFont()
}

/**
 * 预载全部档位 CSS（设置面板打开时调用一次）：让每个选项卡上的字体名
 * 直接用真字体渲染当预览。unicode-range 分片下，预览文案只会拉对应字形
 * 的小分片（每档几十 KB），不会整包下载。
 */
export function ensureFontPreviews() {
  // #ifdef H5
  try {
    FONT_OPTS.forEach((o) => o.css.forEach(injectCss))
  } catch (e) { /* 忽略 */ }
  // #endif
}

// ── 仿真站牌设计 ──
// 启用后，实时线路的「线路走向」改用公交站牌风格呈现（站点横排 + 连线 + 首末站高亮）。
// 纯展示开关，不改动数据链路；默认关闭，本机记忆。
const SIGNBOARD_KEY = 'whbis:sim-signboard'

export function getSimSignboard() {
  const v = readRaw(SIGNBOARD_KEY, false)
  return v === true || v === 'true' || v === 1 || v === '1'
}

export function setSimSignboard(on) {
  writeRaw(SIGNBOARD_KEY, !!on)
  return getSimSignboard()
}

// ── 线路站牌极简模式 ──
// 启用后，LineStops 改用「站牌」风格渲染：只保留线路头 + 候车信息 + 站点序列，
// 隐藏刷新控件 / 方向分段 / 运营指标等冗余元素。只有开 / 关两档，默认关闭，本机记忆。
// 排列方向固定为竖向（每站一行），不再提供横向滚带；上下行切换与退出入口在面板内。
const MIN_MODE_KEY = 'whbis:min-stops-mode'

export function getMinStopsMode() {
  const v = readRaw(MIN_MODE_KEY, false)
  return v === true || v === 'true' || v === 1 || v === '1'
}

export function setMinStopsMode(on) {
  writeRaw(MIN_MODE_KEY, !!on)
  return getMinStopsMode()
}

// ── 高德地图 Key（用户自填，BYOK） ──
// H5 端：填入后 LineMap 切换为原生 <map> 渲染，走向 / 车辆 / 站点均走高德 JS API，
// 比自绘走向图更贴近真实公交轨迹。留空时保持自绘模式（免 Key 的 OSRM 贴路）。
// 申请地址：https://console.amap.com/dev/#/key （Web端 JS API 类型，个人开发者有免费配额）
const AMAP_KEY_KEY = 'whbis:amap-key'

export function getAmapKey() {
  return String(readRaw(AMAP_KEY_KEY, '') || '').trim()
}

export function setAmapKey(key) {
  const v = String(key == null ? '' : key).trim()
  writeRaw(AMAP_KEY_KEY, v)
  return v
}

/** 读取 KEY：返回 { key, secret }。兼容旧版「一个输入框、英文逗号拼接」的存储格式。 */
export function getAmapKeyPair() {
  const v = getAmapKey()
  const parts = String(v).split(/[,，]/)
  return {
    key: (parts[0] || '').trim(),
    secret: (parts.slice(1).join(',') || '').trim(),
  }
}

/** 分别保存 KEY 与安全密钥：存储仍用 `key,secret` 拼接，loadAmapJsApi 已有拆分逻辑，无需改动 */
export function setAmapKeyPair(key, secret) {
  const k = String(key == null ? '' : key).trim()
  const s = String(secret == null ? '' : secret).trim()
  return setAmapKey(s ? `${k},${s}` : k)
}

// 高德官方轨迹的日调用计数（本机、按自然日）：每次 LineSearch 查询 +1，跨天自动归零。
// 只作本机用量参考（不上传、不代表高德账号实际账单），帮用户估算当日配额消耗。
const AMAP_USAGE_KEY = 'whbis:amap-usage'

function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 读取本机今日已查询次数
export function getAmapUsageToday() {
  let v = null
  try {
    v = uni.getStorageSync(AMAP_USAGE_KEY)
    if (typeof v === 'string') v = JSON.parse(v)
  } catch (e) { v = null }
  if (!v || typeof v !== 'object' || v.date !== todayStr()) return 0
  const n = Number(v.count)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// 记一次高德官方轨迹查询，返回自增后的今日次数
export function bumpAmapUsage() {
  const n = getAmapUsageToday() + 1
  writeRaw(AMAP_USAGE_KEY, { date: todayStr(), count: n })
  return n
}
