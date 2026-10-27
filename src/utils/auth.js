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
const SESSION_TTL = 30 * 24 * 3600 * 1000 // 30 天免登录

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

/** 当前会话对应的账号名；未登录 / 会话过期 / 非预置账号 → null */
export function currentAccount() {
  const ses = readStore(SESSION_KEY)
  if (!ses || !ses.account) return null
  if (!ses.loginAt || Date.now() - ses.loginAt > SESSION_TTL) return null
  if (!EMBEDDED_MAP.has(normAccount(ses.account))) return null
  return ses.account
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
    writeStore(SESSION_KEY, { account: EMBEDDED_MAP.get(acc), loginAt: Date.now() })
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
