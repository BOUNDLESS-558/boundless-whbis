/**
 * Vercel Serverless Function：车辆营运信息读写 API
 *
 * GET  /api/vehicle-ops            → 返回全部车辆档案（数据面板读取）
 * POST /api/vehicle-ops            →  upsert 本轮采集的车辆档案（GitHub Actions 写入）
 *
 * 环境变量（Vercel 面板 → Settings → Environment Variables）：
 *   DATABASE_URL       Neon Postgres 连接串（Marketplace 集成自动注入）
 *   VEHICLE_OPS_TOKEN  自定义 API 密钥（POST 鉴权用；你自己设一个随机串）
 *
 * 数据库表：首次请求时自动 CREATE TABLE IF NOT EXISTS（无需手动去 Neon SQL Editor 执行）。
 * api/init.sql 仅作留档参考。
 */
import { neon } from '@neondatabase/serverless'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
}

let _ensureTable = null
function ensureTable(sql) {
  if (!_ensureTable) {
    _ensureTable = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS vehicle_ops (
        org_id TEXT PRIMARY KEY,
        line_no TEXT,
        company TEXT,
        max_speed NUMERIC DEFAULT 0,
        speed_count INTEGER DEFAULT 0,
        online_at TEXT,
        offline_at TEXT,
        departures INTEGER DEFAULT 0,
        transfers JSONB DEFAULT '[]'::jsonb,
        lines JSONB DEFAULT '[]'::jsonb,
        samples INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`
      await sql`CREATE INDEX IF NOT EXISTS idx_vehicle_ops_line_no ON vehicle_ops (line_no)`
      await sql`CREATE INDEX IF NOT EXISTS idx_vehicle_ops_updated ON vehicle_ops (updated_at DESC)`
    })().catch((e) => { _ensureTable = null; throw e })
  }
  return _ensureTable
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') return res.status(204).end()

  const sql = neon(process.env.DATABASE_URL)
  try {
    await ensureTable(sql)
    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM vehicle_ops ORDER BY updated_at DESC`
      return res.status(200).json({
        updated: rows[0] ? rows[0].updated_at : '',
        buses: rows.reduce((acc, r) => {
          acc[r.org_id] = {
            orgId: r.org_id, lineNo: r.line_no, company: r.company,
            maxSpeed: Number(r.max_speed), speedCount: r.speed_count,
            onlineAt: r.online_at, offlineAt: r.offline_at,
            departures: r.departures, transfers: r.transfers, lines: r.lines,
            samples: r.samples,
          }
          return acc
        }, {}),
      })
    }

    if (req.method === 'DELETE') {
      const token = process.env.VEHICLE_OPS_TOKEN
      if (token && req.headers['x-api-key'] !== token) {
        return res.status(401).json({ error: 'invalid api key' })
      }
      const orgId = String((req.body && req.body.orgId) || req.query?.orgId || '')
      if (!orgId) return res.status(400).json({ error: 'orgId required' })
      await sql`DELETE FROM vehicle_ops WHERE org_id = ${orgId}`
      return res.status(200).json({ ok: true, deleted: orgId })
    }

    if (req.method === 'POST') {
      // 鉴权：POST 必须带 x-api-key，且与 VEHICLE_OPS_TOKEN 一致
      const token = process.env.VEHICLE_OPS_TOKEN
      if (token && req.headers['x-api-key'] !== token) {
        return res.status(401).json({ error: 'invalid api key' })
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const buses = Array.isArray(body.buses) ? body.buses : []
      if (!buses.length) return res.status(200).json({ ok: true, upserted: 0 })

      let upserted = 0
      for (const b of buses) {
        await sql`
          INSERT INTO vehicle_ops (
            org_id, line_no, company, max_speed, speed_count,
            online_at, offline_at, departures, transfers, lines, samples, updated_at
          ) VALUES (
            ${String(b.orgId || '')}, ${String(b.lineNo || '')}, ${String(b.company || '')},
            ${Number(b.maxSpeed) || 0}, ${Number(b.speedCount) || 0},
            ${String(b.onlineAt || '')}, ${String(b.offlineAt || '')},
            ${Number(b.departures) || 0}, ${JSON.stringify(b.transfers || [])}::jsonb,
            ${JSON.stringify(b.lines || [])}::jsonb, ${Number(b.samples) || 0}, now()
          )
          ON CONFLICT (org_id) DO UPDATE SET
            line_no = EXCLUDED.line_no,
            company = EXCLUDED.company,
            max_speed = GREATEST(vehicle_ops.max_speed, EXCLUDED.max_speed),
            speed_count = vehicle_ops.speed_count + EXCLUDED.speed_count,
            online_at = LEAST(vehicle_ops.online_at, EXCLUDED.online_at),
            offline_at = GREATEST(vehicle_ops.offline_at, EXCLUDED.offline_at),
            departures = vehicle_ops.departures + EXCLUDED.departures,
            transfers = EXCLUDED.transfers,
            lines = EXCLUDED.lines,
            samples = vehicle_ops.samples + EXCLUDED.samples,
            updated_at = now()
        `
        upserted++
      }
      return res.status(200).json({ ok: true, upserted })
    }

    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) })
  }
}
