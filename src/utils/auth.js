/**
 * 账号认证（纯前端 · 本地实现 · 预置账号制）
 *
 * 为什么没有服务端校验：后端 customized.wuhanbus.com 是只读查询接口，
 * 实测不存在任何登录/签发端点（见《武汉公交实时API接口文档.md》），
 * 所以账号体系只能落在本机 uni storage —— 仅存「会话」：
 *   - 会话 whbis:session： { account, loginAt }
 * 可用账号为代码内置的 EMBEDDED_ACCOUNTS（管理员预置，不可注册），
 * 默认口令不落地：按 genPass(账号) 的确定性算法现场算，同样的账号永远得到同样的
 * 13 位口令，便于分发。用户可在「账号与设置」里改成本机自定义密码——此时只在
 * 本机存一份 md5 哈希（whbis:pass-override），仍不存明文；未改过的账号不落任何秘密。
 *
 * 诚实说明：这是「使用门槛」而非安全机制，纯前端产物反编译即可绕过，
 * 别拿它保护真正的机密。
 */
import { md5 } from './md5.js'
import { APP_CONFIG } from '../config.js'

const SESSION_KEY = 'whbis:session'
// 数据库会话令牌：DB 登录成功后保存；API 不可用时回退本地预置账号逻辑
const AUTH_TOKEN_KEY = 'whbis:auth-token'
// 自定义密码覆盖表（账号→口令哈希）：只存 md5 不存明文；没改过密码的账号不在表内，登录时回到 genPass 预置口令。
const PASS_OVERRIDE_KEY = 'whbis:pass-override'
// 登录有效期档位（天）：0 = 永不过期。可在「账号与设置」面板里随时调整（立即生效，从当下重算）
const SESSION_DAYS_KEY = 'whbis:session-days'
export const SESSION_DAY_OPTS = [7, 15, 30, 0]
// 旧会话兼容：历史版本没有 expiresAt 字段，统一按登录后 30 天算
const LEGACY_TTL = 30 * 24 * 3600 * 1000

// 预置可用账号（管理员分发列表，按需求内嵌；注册功能已移除）。
// 展示名保留原始大小写；存储 / 比对统一走 normAccount（小写）主键。
// （导出仅供探针复用名单，应用代码不应再各处复制账号名）
export const EMBEDDED_ACCOUNTS = [
  'Jay11011910',
  'wxid_7buto3i56z2122',
  'tomboyfreak',
  'WH6120GD',
  'wuhanbus585',
  'BOUNDLESS_558',
  'l296625',
  'wxid_byqyi6k0nr3r22',
  'WG6120BEVHR3',
  'Lazian-',
  'XY8xiaoyu8',
  'turbo',
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

/** 调数据库认证 API；网络/服务不可用时返回 null，由调用方回退本地逻辑 */
function authRequest(data, token) {
  return new Promise((resolve) => {
    try {
      uni.request({
        url: APP_CONFIG.authApi,
        method: 'POST',
        timeout: 6000,
        header: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-auth-token': token } : {}),
        },
        data,
        success: (res) => resolve(res && res.statusCode === 200 ? (res.data || null) : null),
        fail: () => resolve(null),
      })
    } catch (e) { resolve(null) }
  })
}

// —— 自定义密码（本机覆盖预置口令）——
// 按账号加盐的 md5：同一账号同一密码永远得到同一哈希，不存明文。
export function hashPass(account, pwd) {
  return md5(PASS_SECRET + 'u:' + normAccount(account) + ':' + String(pwd))
}
function readOverrides() {
  const v = readStore(PASS_OVERRIDE_KEY)
  return v && typeof v === 'object' ? v : {}
}

/** 该账号是否已自定义密码（改过密码）；否则用预置的确定性口令 */
export function hasCustomPass(account) {
  return !!readOverrides()[normAccount(account)]
}

/** 校验口令：有自定义哈希则比哈希，否则比 genPass 预置口令 */
export function verifyPass(account, password) {
  if (!password) return false
  const h = readOverrides()[normAccount(account)]
  if (h) return h === hashPass(account, password)
  return String(password) === genPass(account)
}

/** 设置新密码（6~32 位），写哈希覆盖；限预置账号 */
export function setPassword(account, newPass) {
  const acc = normAccount(account)
  if (!acc || !EMBEDDED_MAP.has(acc)) return { ok: false, error: '账号不存在' }
  const p = String(newPass == null ? '' : newPass)
  if (p.length < 6 || p.length > 32) return { ok: false, error: '新密码需 6~32 位' }
  const o = readOverrides()
  o[acc] = hashPass(account, p)
  if (!writeStore(PASS_OVERRIDE_KEY, o)) return { ok: false, error: '存储不可用，密码未保存' }
  return { ok: true }
}

/** 本地恢复默认口令：删覆盖条目，回到 genPass 预置口令 */
function localReset(account) {
  const acc = normAccount(account)
  const o = readOverrides()
  if (o[acc]) {
    delete o[acc]
    if (!writeStore(PASS_OVERRIDE_KEY, o)) return { ok: false, error: '存储不可用，未恢复' }
  }
  return { ok: true }
}

/** 改密：优先写数据库会话，失败回退本机覆盖哈希（离线可用） */
export async function changePassword(account, newPass) {
  const p = String(newPass == null ? '' : newPass)
  if (p.length < 6 || p.length > 32) return { ok: false, error: '新密码需 6~32 位' }
  const token = String(uni.getStorageSync(AUTH_TOKEN_KEY) || '')
  if (token) {
    const r = await authRequest({ action: 'change', newPass: p }, token)
    if (r && r.ok) {
      setPassword(account, p) // 同步本地哈希，保证后续离线登录也用新口令
      return { ok: true, source: 'db' }
    }
    if (r && r.error) return { ok: false, error: r.error }
  }
  return setPassword(account, p)
}

/** 恢复默认口令：优先同步数据库，失败回退本机（无需旧密码） */
export async function resetPassword(account) {
  const token = String(uni.getStorageSync(AUTH_TOKEN_KEY) || '')
  if (token) {
    const r = await authRequest({ action: 'reset' }, token)
    if (r && r.ok) {
      localReset(account)
      return { ok: true, source: 'db' }
    }
    if (r && r.error) return { ok: false, error: r.error }
  }
  return localReset(account)
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
export async function login(account, password) {
  const acc = normAccount(account)
  if (!acc || !password) return { ok: false, error: '请输入账号和密码' }
  const days = getSessionDays()

  // 1) 优先走数据库；API 返回明确错误时直接反馈，网络失败才回退本地
  const db = await authRequest({ action: 'login', account, password, days })
  if (db && db.ok) {
    writeStore(SESSION_KEY, {
      account: db.account || EMBEDDED_MAP.get(acc) || account,
      loginAt: Date.now(),
      expiresAt: db.expiresAt || 0,
    })
    writeStore(AUTH_TOKEN_KEY, db.token || '')
    return { ok: true, source: 'db' }
  }
  if (db && db.error) {
    // 线上口令与本地自定义口令不一致时（离线改过密码），用默认口令换 token 后把新口令同步上去
    if (db.error === '密码错误' && EMBEDDED_MAP.has(acc) && verifyPass(account, password)) {
      const def = await authRequest({ action: 'login', account, password: genPass(account), days })
      if (def && def.ok) {
        await authRequest({ action: 'change', newPass: String(password) }, def.token)
        writeStore(SESSION_KEY, { account: def.account || EMBEDDED_MAP.get(acc), loginAt: Date.now(), expiresAt: def.expiresAt || 0 })
        writeStore(AUTH_TOKEN_KEY, def.token || '')
        return { ok: true, source: 'db-synced' }
      }
    } else {
      return { ok: false, error: db.error }
    }
  }

  // 2) 本地兜底：保留离线可用（预置账号 + 本机自定义口令哈希）
  if (!EMBEDDED_MAP.has(acc)) return { ok: false, error: '账号不存在' }
  if (!verifyPass(account, password)) return { ok: false, error: '密码错误' }
  writeStore(SESSION_KEY, {
    account: EMBEDDED_MAP.get(acc),
    loginAt: Date.now(),
    expiresAt: days > 0 ? Date.now() + days * 86400000 : 0,
  })
  return { ok: true, source: 'local' }
}

/** 注销：清会话（账户表保留，下次直接登录） */
export function logout() {
  try {
    uni.removeStorageSync(SESSION_KEY)
    uni.removeStorageSync(AUTH_TOKEN_KEY)
  } catch (e) { /* 清不掉也不阻塞回登录页 */ }
}

/**
 * 「记住我」：可逆存储账号 + 密码，但【绝不落明文】。
 * 本系统本就是使用门槛而非安全机制（见文件头），故不引入 Web Crypto
 * （App 端 crypto.subtle 不可用、且 localStorage 反编译即可读），改用纯 JS 的
 * 「固定盐 + 账号」派生密钥流对密码做字节异或——可逆、非明文、两端通用。
 * 存储形态：{ a: 规范账号, c: base64(密文) }
 */
const REMEMBER_KEY = 'whbis:remember-me'
const REMEMBER_SECRET = 'whbis:remember:v1:'
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function b64enc(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    s += B64[b0 >> 2]
    s += B64[((b0 & 3) << 4) | (b1 >> 4)]
    s += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | (b2 >> 6)]
    s += b2 === undefined ? '' : B64[b2 & 63]
  }
  return s
}
function b64dec(str) {
  const clean = String(str).replace(/=+$/, '')
  const bytes = []
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i])
    const c1 = B64.indexOf(clean[i + 1])
    const c2 = B64.indexOf(clean[i + 2])
    const c3 = B64.indexOf(clean[i + 3])
    bytes.push((c0 << 2) | (c1 >> 4))
    if (clean[i + 2] && c2 !== -1) bytes.push(((c1 & 15) << 4) | (c2 >> 2))
    // 第 3 个字节只取 c2 的低 2 位（&3）；写成 &15 会解出 >255 的字节，
    // 导致 XOR 还原错乱、bytesUtf8 抛 URIError，loadRemember 被 catch 吞掉返回 null（记住我失效）。
    if (clean[i + 3] && c3 !== -1) bytes.push(((c2 & 3) << 6) | c3)
  }
  return bytes
}
// 派生与密码等长的密钥流：md5(盐 + 账号 + ':' + 计数) 拼接取字节
function deriveKeystream(account, len) {
  const base = REMEMBER_SECRET + normAccount(account)
  const ks = []
  let n = 0
  while (ks.length < len) {
    const h = md5(base + ':' + n)
    for (let i = 0; i < h.length && ks.length < len; i += 2) ks.push(parseInt(h.substr(i, 2), 16))
    n++
  }
  return ks
}
function utf8Bytes(str) {
  return Array.from(unescape(encodeURIComponent(String(str))), (c) => c.charCodeAt(0))
}
function bytesUtf8(bytes) {
  return decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)))
}
function xor(a, k) {
  return a.map((b, i) => b ^ k[i])
}

export function saveRemember(account, password) {
  const norm = normAccount(account)
  const raw = String(account == null ? '' : account).trim()
  if (!norm || !password) return false
  const inB = utf8Bytes(password)
  const ct = xor(inB, deriveKeystream(norm, inB.length))
  // a 存「原始大小写」账号供登录页原样回填（BOUNDLESS_558 不会被拉成小写）；
  // 密钥流仍按归一账号派生，与 loadRemember 的 normAccount(v.a) 一致，旧存档也能解。
  return writeStore(REMEMBER_KEY, { a: raw || norm, c: b64enc(ct) })
}
export function loadRemember() {
  const v = readStore(REMEMBER_KEY)
  if (!v || !v.a || !v.c) return null
  try {
    const ct = b64dec(v.c)
    // 密钥流按归一账号派生：兼容旧存档（a 曾是小写 norm）与新存档（a 为原始大小写）
    const pt = xor(ct, deriveKeystream(normAccount(v.a), ct.length))
    return { account: v.a, password: bytesUtf8(pt) }
  } catch (e) {
    return null
  }
}
export function clearRemember() {
  try {
    uni.removeStorageSync(REMEMBER_KEY)
  } catch (e) { /* 忽略 */ }
}
export function hasRemember() {
  const v = readStore(REMEMBER_KEY)
  return !!(v && v.a && v.c)
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
