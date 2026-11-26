/**
 * Vercel Serverless Function：车辆营运信息读写 API
 *
 * GET  /api/vehicle-ops                       → 返回全部车辆档案（旧数据面板兼容）
 * GET  /api/vehicle-ops?view=daily&date=...   → 按日/公司/线路筛选 + 分页的数据面板数据
 * POST /api/vehicle-ops                       → upsert 本轮采集的车辆档案（Actions 写入）
 * DELETE /api/vehicle-ops?orgId=...           → 删除累计档案
 *
 * 环境变量（Vercel 面板 → Settings → Environment Variables）：
 *   DATABASE_URL       Neon Postgres 连接串（Marketplace 集成自动注入）
 *   VEHICLE_OPS_TOKEN  自定义 API 密钥（POST/DELETE 鉴权用，必须与 GitHub Secret 同值）
 *
 * 数据库表：首次请求时自动 CREATE TABLE IF NOT EXISTS（api/init.sql 仅作留档参考）。
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

      // 按日营运信息：数据面板的历史真源（PK = 日期 + 自编号）
      await sql`CREATE TABLE IF NOT EXISTS vehicle_ops_daily (
        date DATE NOT NULL,
        org_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT '',
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
        updated_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (date, org_id)
      )`
      await sql`CREATE INDEX IF NOT EXISTS idx_vod_date ON vehicle_ops_daily (date DESC)`
      await sql`CREATE INDEX IF NOT EXISTS idx_vod_company_date ON vehicle_ops_daily (company, date DESC)`
      await sql`CREATE INDEX IF NOT EXISTS idx_vod_line_date ON vehicle_ops_daily (line_no, date DESC)`
    })().catch((e) => { _ensureTable = null; throw e })
  }
  return _ensureTable
}

/** 采集时刻 AT = 'YYYY-MM-DD HH:mm' → { date, recordedAt } */
function parseAt(at) {
  const s = String(at || '')
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/)
  if (m) return { date: m[1], recordedAt: m[2] }
  // 无 at 时按北京时间兜底（采集脚本始终带 at，这里只保护手工调用）
  const bj = new Date(Date.now() + 8 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return {
    date: `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())}`,
    recordedAt: `${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`,
  }
}

/** 旧结构行 → 数据面板 camelCase 行 */
function toRow(r, daily = false) {
  const out = {
    orgId: r.org_id, lineNo: r.line_no, company: r.company,
    maxSpeed: Number(r.max_speed), speedCount: Number(r.speed_count),
    onlineAt: r.online_at, offlineAt: r.offline_at,
    departures: Number(r.departures), transfers: r.transfers, lines: r.lines,
    samples: Number(r.samples),
  }
  if (daily) {
    out.date = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date || '')
    out.recordedAt = String(r.recorded_at || '')
  }
  return out
}

/** 数据面板：按日/公司/线路筛选 + 分页（服务端下推） */
async function getDaily(sql, res, q) {
  const where = []
  const params = []
  const add = (clause, ...values) => {
    let out = clause
    for (const v of values) {
      params.push(v)
      out = out.replace('?', `$${params.length}`)
    }
    where.push(out)
  }

  if (q.date) add('date = ?::date', q.date)
  else if (q.year) add('EXTRACT(YEAR FROM date) = ?', Number(q.year))
  if (q.month && !q.date) add('EXTRACT(MONTH FROM date) = ?', Number(q.month))
  if (q.company) add("company ILIKE '%' || ? || '%'", q.company)
  if (q.line) add("(line_no = ? OR lines::text LIKE '%' || ? || '%')", q.line, q.line)
  if (q.keyword) add(
    "(org_id ILIKE '%' || ? || '%' OR line_no ILIKE '%' || ? || '%' OR company ILIKE '%' || ? || '%')",
    q.keyword, q.keyword, q.keyword,
  )
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const countRes = await sql.query(`SELECT count(*)::int AS total FROM vehicle_ops_daily ${whereSql}`, params)
  const total = countRes[0] ? Number(countRes[0].total) : 0

  let limitSql = ''
  if (q.all !== '1') {
    const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize, 10) || 20))
    const page = Math.max(1, parseInt(q.page, 10) || 1)
    params.push(pageSize, (page - 1) * pageSize)
    limitSql = ` LIMIT $${params.length - 1} OFFSET $${params.length}`
  }

  const rows = await sql.query(
    `SELECT * FROM vehicle_ops_daily ${whereSql} ORDER BY date DESC, recorded_at DESC, max_speed DESC${limitSql}`,
    params,
  )
  const updated = rows.length ? String(rows[0].updated_at || '') : ''
  // 筛选项：从按日表取全量候选值，供面板生成 日期 / 公司 / 线路 下拉
  const days = (await sql`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM vehicle_ops_daily GROUP BY date ORDER BY date DESC`)
    .map((r) => r.d).filter(Boolean)
  const companies = (await sql`SELECT DISTINCT company FROM vehicle_ops_daily WHERE company IS NOT NULL AND company <> '' ORDER BY company`)
    .map((r) => r.company).filter(Boolean)
  const lines = (await sql`SELECT DISTINCT line_no FROM vehicle_ops_daily WHERE line_no IS NOT NULL AND line_no <> '' ORDER BY line_no`)
    .map((r) => r.line_no).filter(Boolean)
  return res.status(200).json({ total, updated, days, companies, lines, rows: rows.map((r) => toRow(r, true)) })
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') return res.status(204).end()

  const sql = neon(process.env.DATABASE_URL)
  try {
    await ensureTable(sql)
    if (req.method === 'GET') {
      const q = req.query || {}
      if (q.view === 'daily') return await getDaily(sql, res, q)
      const rows = await sql`SELECT * FROM vehicle_ops ORDER BY updated_at DESC`
      return res.status(200).json({
        updated: rows[0] ? rows[0].updated_at : '',
        buses: rows.reduce((acc, r) => {
          acc[r.org_id] = toRow(r)
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
      const token = process.env.VEHICLE_OPS_TOKEN
      if (token && req.headers['x-api-key'] !== token) {
        return res.status(401).json({ error: 'invalid api key' })
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const buses = Array.isArray(body.buses) ? body.buses : []
      if (!buses.length) return res.status(200).json({ ok: true, upserted: 0 })
      const { date, recordedAt } = parseAt(body.at)
      // 回填历史快照时只写按日表，避免把历史数据重复累加进累计表 vehicle_ops
      const dailyOnly = body.dailyOnly === true

      let upserted = 0
      for (const b of buses) {
        if (!dailyOnly) await sql`
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
        // 按日表：每轮是全量扫描，累计字段取当日最大值，避免跨轮重复累加
        await sql`
          INSERT INTO vehicle_ops_daily (
            date, org_id, recorded_at, line_no, company, max_speed, speed_count,
            online_at, offline_at, departures, transfers, lines, samples, updated_at
          ) VALUES (
            ${date}::date, ${String(b.orgId || '')}, ${recordedAt},
            ${String(b.lineNo || '')}, ${String(b.company || '')},
            ${Number(b.maxSpeed) || 0}, ${Number(b.speedCount) || 0},
            ${String(b.onlineAt || '')}, ${String(b.offlineAt || '')},
            ${Number(b.departures) || 0}, ${JSON.stringify(b.transfers || [])}::jsonb,
            ${JSON.stringify(b.lines || [])}::jsonb, ${Number(b.samples) || 0}, now()
          )
          ON CONFLICT (date, org_id) DO UPDATE SET
            recorded_at = EXCLUDED.recorded_at,
            line_no = EXCLUDED.line_no,
            company = EXCLUDED.company,
            max_speed = GREATEST(vehicle_ops_daily.max_speed, EXCLUDED.max_speed),
            speed_count = GREATEST(vehicle_ops_daily.speed_count, EXCLUDED.speed_count),
            online_at = LEAST(
              COALESCE(NULLIF(vehicle_ops_daily.online_at, ''), EXCLUDED.online_at), EXCLUDED.online_at
            ),
            offline_at = GREATEST(vehicle_ops_daily.offline_at, EXCLUDED.offline_at),
            departures = GREATEST(vehicle_ops_daily.departures, EXCLUDED.departures),
            transfers = EXCLUDED.transfers,
            lines = EXCLUDED.lines,
            samples = GREATEST(vehicle_ops_daily.samples, EXCLUDED.samples),
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
