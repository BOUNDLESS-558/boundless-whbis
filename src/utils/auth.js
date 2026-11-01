/**
 * 账号认证（纯前端 · 本地实现 · 预置账号制）
 *
 * 为什么没有服务端校验：后端 customized.wuhanbus.com 是只读查询接口，
 * 实测不存在任何登录/签发端点（见《武汉公交实时API接口文档.md》），
 * 所以账号体系只能落在本机 uni storage —— 仅存「会话」：
 *   - 会话 whbis:session： { account, loginAt }
 * 可用账号为代码内置的 EMBEDDED_ACCOUNTS（管理员预置，不可注册），
 * 密码不存明文也不存哈希，而是按 genPass(账号) 的确定性算法现场算：
 * 同样的账号永远得到同样的 13 位口令，便于分发又不落地任何秘密。
 *
 * 诚实说明：这是「使用门槛」而非安全机制，纯前端产物反编译即可绕过，
 * 别拿它保护真正的机密。
 */
import { md5 } from './md5.js'

const SESSION_KEY = 'whbis:session'
// 登录有效期档位（天）：0 = 永不过期。可在「账号与设置」面板里随时调整（立即生效，从当下重算）
const SESSION_DAYS_KEY = 'whbis:session-days'
export const SESSION_DAY_OPTS = [7, 15, 30, 0]
// 旧会话兼容：历史版本没有 expiresAt 字段，统一按登录后 30 天算
const LEGACY_TTL = 30 * 24 * 3600 * 1000

// 预置可用账号（管理员分发列表，按需求内嵌；注册功能已移除）。
// 展示名保留原始大小写；存储 / 比对统一走 normAccount（小写）主键。
const EMBEDDED_ACCOUNTS = [
  'Jay11011910',
  'wxid_7buto3i56z2122',
  'tomboyfreak',
  'WH6120GD',
  'wuhanbus585',
  'BOUNDELSS_558',
  'l296625',
  'wxid_byqyi6k0nr3r22',
  'WG6120BEVHR3',
  'Lazian-',
  'XY8xiaoyu8',
]
const EMBEDDED_MAP = new Map(EMBEDDED_ACCOUNTS.map((n) => [normAccount(n), n]))

// 口令算法：账号名 → 确定性 13 位口令（62 进制字母数字串）。
// PASS_SECRET 是固定盐；取 md5(盐 + 账号) 的前 13 个字节映射到字母表。
const PASS_SECRET = 'whbis:pass:v1:'
const PASS_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const PASS_LEN = 13

export function genPass(account) {
  const norm = normAccount(account)
  const h = md5(PASS_SECRET + norm) // 32 位小写十六进制（128 bit）
  let out = ''
  for (let i = 0; i < PASS_LEN; i++) {
    const byte = parseInt(h.substr(i * 2, 2), 16) // [0,255]
    out += PASS_ALPHABET[byte % PASS_ALPHABET.length]
  }
  return out
}

/** 规范账号：trim + 小写（作存储主键）；展示保留用户输入的原样 label */
export function normAccount(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
}

// uni H5 的 getStorageSync 在键不存在时返回空字符串，读写都要兜底成对象
function readStore(key) {
  let v
  try {
    v = uni.getStorageSync(key)
  } catch (e) {
    return {}
  }
  if (!v) return {}
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch (e) { return {} }
  }
  return v && typeof v === 'object' ? v : {}
}

function writeStore(key, val) {
  try {
    uni.setStorageSync(key, val)
    return true
  } catch (e) {
    return false
  }
}

/** 会话到期时间戳：显式 0 = 永不过期；缺失（旧会话）= loginAt + 30 天 */
function expiryOf(ses) {
  if (!ses) return 0
  if (ses.expiresAt === 0) return 0
  if (ses.expiresAt) return ses.expiresAt
  return (ses.loginAt || 0) + LEGACY_TTL
}

/** 当前会话对应的账号名；未登录 / 会话过期 / 非预置账号 → null */
export function currentAccount() {
  const ses = readStore(SESSION_KEY)
  if (!ses || !ses.account) return null
  if (!ses.loginAt) return null
  const exp = expiryOf(ses)
  if (exp && Date.now() > exp) return null
  if (!EMBEDDED_MAP.has(normAccount(ses.account))) return null
  return ses.account
}

/** 会话详情（面板展示用）：null = 未登录/已过期；expiresAt 为 0 表示永不过期 */
export function getSessionInfo() {
  const ses = readStore(SESSION_KEY)
  if (!ses || !ses.account || !ses.loginAt) return null
  if (!EMBEDDED_MAP.has(normAccount(ses.account))) return null
  const exp = expiryOf(ses)
  if (exp && Date.now() > exp) return null
  return { account: ses.account, loginAt: ses.loginAt, expiresAt: exp }
}

/** 登录有效期档位（天，0 = 永不过期）；未设置过默认 30 天 */
export function getSessionDays() {
  try {
    const v = Number(uni.getStorageSync(SESSION_DAYS_KEY))
    if (SESSION_DAY_OPTS.includes(v)) return v
  } catch (e) { /* 存储不可用走默认 */ }
  return 30
}

/** 调整登录有效期：立即生效——已登录时从当下重算当前会话的到期时间 */
export function setSessionDays(days) {
  const d = SESSION_DAY_OPTS.includes(Number(days)) ? Number(days) : 30
  writeStore(SESSION_DAYS_KEY, d)
  const ses = readStore(SESSION_KEY)
  if (ses && ses.account && EMBEDDED_MAP.has(normAccount(ses.account)) && ses.loginAt) {
    ses.expiresAt = d > 0 ? Date.now() + d * 86400000 : 0
    writeStore(SESSION_KEY, ses)
  }
  return d
}

export function isLoggedIn() {
  return !!currentAccount()
}

/**
 * 登录：只认预置账号（EMBEDDED_ACCOUNTS），密码按 genPass 确定性校验（不落地任何秘密）。
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function login(account, password) {
  return new Promise((resolve) => {
    const acc = normAccount(account)
    if (!acc || !password) return resolve({ ok: false, error: '请输入账号和密码' })
    if (!EMBEDDED_MAP.has(acc)) return resolve({ ok: false, error: '账号不存在' })
    if (String(password) !== genPass(account)) return resolve({ ok: false, error: '密码错误' })
    const days = getSessionDays()
    writeStore(SESSION_KEY, {
      account: EMBEDDED_MAP.get(acc),
      loginAt: Date.now(),
      // expiresAt：0 = 永不过期；其余为到期时间戳
      expiresAt: days > 0 ? Date.now() + days * 86400000 : 0,
    })
    resolve({ ok: true })
  })
}

/** 注销：清会话（账户表保留，下次直接登录） */
export function logout() {
  try {
    uni.removeStorageSync(SESSION_KEY)
  } catch (e) { /* 清不掉也不阻塞回登录页 */ }
}

/**
 * 页面守卫：未登录时重定向到登录页。
 * redirect 只在 H5 携带当前 hash 路由（登录后原位恢复），
 * App 端登录页不解析该参数，返回即进首页。
 */
export function requireLogin() {
  if (isLoggedIn()) return true
  let url = '/pages/login/login'
  // #ifdef H5
  const hash = String(window.location.hash || '')
  if (hash.startsWith('#/')) {
    url += '?redirect=' + encodeURIComponent(hash.slice(1))
  }
  // #endif
  uni.redirectTo({ url })
  return false
}
