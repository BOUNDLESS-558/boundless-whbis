/**
 * Vercel Serverless Function：账号认证（数据库表版）
 *
 * POST /api/auth { action:'login'|'change'|'reset', account, password, newPass, days, token }
 *   login  → 公开校验 app_accounts.pass_hash，签发 app_sessions token
 *   change → 需 x-auth-token，改本账号口令哈希
 *   reset  → 需 x-auth-token，恢复为 genPass(account) 默认口令
 *
 * 哈希算法与 src/utils/auth.js 的 hashPass/genPass 完全一致，
 * 因此预置账号的默认口令不变；首次请求自动 seed 内嵌账号。
 */
import { neon } from '@neondatabase/serverless'
import { randomBytes } from 'node:crypto'
import { EMBEDDED_ACCOUNTS, genPass, hashPass, normAccount } from '../src/utils/auth.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
}
const FOREVER = 4102444800000 // 2100-01-01

let _ready = null
async function ensureReady(sql) {
  if (!_ready) {
    _ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS app_accounts (
        norm_account TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`
      await sql`CREATE TABLE IF NOT EXISTS app_sessions (
        token TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )`
      for (const label of EMBEDDED_ACCOUNTS) {
        await sql`
          INSERT INTO app_accounts (norm_account, label, pass_hash)
          VALUES (${normAccount(label)}, ${label}, ${hashPass(label, genPass(label))})
          ON CONFLICT (norm_account) DO NOTHING
        `
      }
    })().catch((e) => { _ready = null; throw e })
  }
  return _ready
}

async function currentSession(sql, req) {
  const token = String(req.headers['x-auth-token'] || '')
  if (!token) return null
  const rows = await sql`SELECT * FROM app_sessions WHERE token = ${token}`
  const s = rows[0]
  if (!s || (Number(s.expires_at) && Date.now() > Number(s.expires_at))) return null
  return s
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const sql = neon(process.env.DATABASE_URL)
  try {
    await ensureReady(sql)
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const action = String(body.action || 'login')

    if (action === 'login') {
      const account = String(body.account || '')
      const password = String(body.password || '')
      const norm = normAccount(account)
      if (!norm || !password) return res.status(400).json({ ok: false, error: '请输入账号和密码' })
      const rows = await sql`SELECT * FROM app_accounts WHERE norm_account = ${norm}`
      const acc = rows[0]
      if (!acc) return res.status(200).json({ ok: false, error: '账号不存在' })
      if (acc.pass_hash !== hashPass(acc.label, password)) {
        return res.status(200).json({ ok: false, error: '密码错误' })
      }
      const days = [7, 15, 30, 0].includes(Number(body.days)) ? Number(body.days) : 30
      const expiresAt = days > 0 ? Date.now() + days * 86400000 : FOREVER
      const token = randomBytes(24).toString('hex')
      await sql`
        INSERT INTO app_sessions (token, account, expires_at)
        VALUES (${token}, ${acc.label}, ${expiresAt})
      `
      return res.status(200).json({ ok: true, token, account: acc.label, expiresAt, source: 'db' })
    }

    const session = await currentSession(sql, req)
    if (!session) return res.status(401).json({ ok: false, error: '会话无效或已过期' })
    const norm = normAccount(session.account)
    const rows = await sql`SELECT * FROM app_accounts WHERE norm_account = ${norm}`
    const acc = rows[0]
    if (!acc) return res.status(200).json({ ok: false, error: '账号不存在' })

    if (action === 'change') {
      const p = String(body.newPass == null ? '' : body.newPass)
      if (p.length < 6 || p.length > 32) {
        return res.status(200).json({ ok: false, error: '新密码需 6~32 位' })
      }
      await sql`UPDATE app_accounts SET pass_hash = ${hashPass(acc.label, p)}, updated_at = now() WHERE norm_account = ${norm}`
      return res.status(200).json({ ok: true })
    }

    if (action === 'reset') {
      await sql`UPDATE app_accounts SET pass_hash = ${hashPass(acc.label, genPass(acc.label))}, updated_at = now() WHERE norm_account = ${norm}`
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ ok: false, error: 'unknown action' })
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) })
  }
}
