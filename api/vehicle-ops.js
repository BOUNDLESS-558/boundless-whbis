/**
 * Vercel Serverless Function：车辆营运信息读写 API
 *
 * GET  /api/vehicle-ops                       → 返回全部车辆档案（旧数据面板兼容）
 * GET  /api/vehicle-ops?view=daily&date=...   → 按日/公司/线路筛选 + 分页的数据面板数据
 * GET  /api/vehicle-ops?view=vehicle&orgId=... → 车辆档案：按自编号查跨日超速/调配历史
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

/**
 * 车辆档案：按自编号（纯数字 orgId）查跨日历史。
 * 返回该车每日记录（日期/线路/最高车速/超速次数/发车/线路集合），
 * 并在前端可据此推导调配（相邻记录 line_no 变化）。
 */
async function getVehicleHistory(sql, res, q) {
  const orgId = String(q.orgId || '').trim()
  if (!orgId) return res.status(400).json({ error: 'orgId required' })
  const where = ['org_id = ?']
  const params = [orgId]
  const add = (clause, ...values) => {
    let out = clause
    for (const v of values) { params.push(v); out = out.replace('?', `$${params.length}`) }
    where.push(out)
  }
  if (q.from) add('date >= ?::date', q.from)
  if (q.to) add('date <= ?::date', q.to)
  const rows = await sql.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, line_no, company, max_speed, speed_count,
            online_at, offline_at, departures, transfers, lines, samples, recorded_at
     FROM vehicle_ops_daily
     WHERE ${where.join(' AND ')}
     ORDER BY date DESC, recorded_at DESC`,
    params,
  )
  // 累计档案（车型/公司/总超速等）从 vehicle_ops 取
  const cum = await sql`SELECT * FROM vehicle_ops WHERE org_id = ${orgId} LIMIT 1`
  const c = cum[0] || null
  return res.status(200).json({
    orgId,
    company: c ? c.company : (rows[0] ? rows[0].company : ''),
    maxSpeed: c ? Number(c.max_speed) : 0,
    totalSpeedCount: c ? Number(c.speed_count) : 0,
    totalDepartures: c ? Number(c.departures) : 0,
    days: rows.map((r) => ({
      date: r.date, lineNo: r.line_no, recordedAt: r.recorded_at,
      maxSpeed: Number(r.max_speed), speedCount: Number(r.speed_count),
      departures: Number(r.departures), transfers: r.transfers || [],
      lines: r.lines || [], samples: Number(r.samples),
    })),
    updated: rows.length ? String(rows[0].recorded_at || '') : '',
  })
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

/**
 * 批量写入：整轮车辆档案压成 2 条 SQL（累计表 + 按日表），不再逐车 await。
 * 逐车串行时 N 辆车要跑 2N 条 SQL，在 Serverless 单次请求里很容易逼近函数超时；
 * 批量后 SQL 条数与车辆数无关（恒为 2，dailyOnly 时 1）。
 * 各 ON CONFLICT 子句的累加 / 取极值语义与旧逐车版保持一致。
 */
const RECORD_COLS = `org_id TEXT, line_no TEXT, company TEXT, max_speed NUMERIC, speed_count INTEGER,
    online_at TEXT, offline_at TEXT, departures INTEGER, transfers JSONB, lines JSONB, samples INTEGER`

const UPSERT_CUMULATIVE = `
  INSERT INTO vehicle_ops (
    org_id, line_no, company, max_speed, speed_count,
    online_at, offline_at, departures, transfers, lines, samples, updated_at
  )
  SELECT
    b.org_id, b.line_no, b.company, b.max_speed, b.speed_count,
    b.online_at, b.offline_at, b.departures, b.transfers, b.lines, b.samples, now()
  FROM jsonb_to_recordset($1::jsonb) AS b(${RECORD_COLS})
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

const UPSERT_DAILY = `
  INSERT INTO vehicle_ops_daily (
    date, org_id, recorded_at, line_no, company, max_speed, speed_count,
    online_at, offline_at, departures, transfers, lines, samples, updated_at
  )
  SELECT
    $2::date, b.org_id, $3::text, b.line_no, b.company, b.max_speed, b.speed_count,
    b.online_at, b.offline_at, b.departures, b.transfers, b.lines, b.samples, now()
  FROM jsonb_to_recordset($1::jsonb) AS b(${RECORD_COLS})
  ON CONFLICT (date, org_id) DO UPDATE SET
    recorded_at = EXCLUDED.recorded_at,
    line_no = EXCLUDED.line_no,
    company = EXCLUDED.company,
    max_speed = GREATEST(vehicle_ops_daily.max_speed, EXCLUDED.max_speed),
    -- 天累计：每轮采集若超速则 +1（单轮 speed_count 为 0/1），不再取 MAX（永远只显示 1）
    speed_count = vehicle_ops_daily.speed_count + EXCLUDED.speed_count,
    online_at = LEAST(
      COALESCE(NULLIF(vehicle_ops_daily.online_at, ''), EXCLUDED.online_at), EXCLUDED.online_at
    ),
    offline_at = GREATEST(vehicle_ops_daily.offline_at, EXCLUDED.offline_at),
    departures = vehicle_ops_daily.departures + EXCLUDED.departures,
    transfers = EXCLUDED.transfers,
    lines = EXCLUDED.lines,
    samples = GREATEST(vehicle_ops_daily.samples, EXCLUDED.samples),
    updated_at = now()
`

/**
 * 归一化单行字段（与旧逐车逻辑一致），并按 orgId 去重，
 * 避免批量 ON CONFLICT 报 "affect row a second time"。
 * ⚠ key 必须是 snake_case 且与 RECORD_COLS 的列名逐一对应：
 * jsonb_to_recordset 按 JSON key 匹配列名，写成驼峰会让字段静默变 NULL。
 */
function normalizeBuses(buses) {
  const map = new Map()
  for (const b of buses || []) {
    const orgId = String((b && b.orgId) || '')
    if (!orgId) continue
    map.set(orgId, {
      org_id: orgId,
      line_no: String((b && b.lineNo) || ''),
      company: String((b && b.company) || ''),
      max_speed: Number(b && b.maxSpeed) || 0,
      speed_count: Number(b && b.speedCount) || 0,
      online_at: String((b && b.onlineAt) || ''),
      offline_at: String((b && b.offlineAt) || ''),
      departures: Number(b && b.departures) || 0,
      transfers: Array.isArray(b && b.transfers) ? b.transfers : [],
      lines: Array.isArray(b && b.lines) ? b.lines : [],
      samples: Number(b && b.samples) || 0,
    })
  }
  return Array.from(map.values())
}

export async function upsertBuses(sql, buses, { date, recordedAt, dailyOnly = false } = {}) {
  const rows = normalizeBuses(buses)
  if (!rows.length) return 0
  const payload = JSON.stringify(rows)
  if (!dailyOnly) await sql.query(UPSERT_CUMULATIVE, [payload])
  await sql.query(UPSERT_DAILY, [payload, date, recordedAt])
  return rows.length
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
      if (q.view === 'vehicle') return await getVehicleHistory(sql, res, q)
      if (q.view === 'vehicles') {
        // 车辆选择列表：累计表全量（轻量字段），前端用 buspedia 映射补全完整编号/车型
        const rows = await sql`SELECT org_id, line_no, company, max_speed, speed_count,
          departures, updated_at FROM vehicle_ops ORDER BY speed_count DESC, max_speed DESC`
        return res.status(200).json({
          updated: rows[0] ? String(rows[0].updated_at || '') : '',
          vehicles: rows.map((r) => ({
            orgId: r.org_id, lineNo: r.line_no, company: r.company,
            maxSpeed: Number(r.max_speed) || 0, speedCount: Number(r.speed_count) || 0,
            departures: Number(r.departures) || 0,
          })),
        })
      }
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
      // ?all=1 清空两张表（累计表 + 按日表），用于重新采集前重置数据
      if (req.query?.all === '1') {
        await sql`TRUNCATE TABLE vehicle_ops, vehicle_ops_daily`
        return res.status(200).json({ ok: true, truncated: ['vehicle_ops', 'vehicle_ops_daily'] })
      }
      const orgId = String((req.body && req.body.orgId) || req.query?.orgId || '')
      if (!orgId) return res.status(400).json({ error: 'orgId required' })
      await sql`DELETE FROM vehicle_ops WHERE org_id = ${orgId}`
      await sql`DELETE FROM vehicle_ops_daily WHERE org_id = ${orgId}`
      return res.status(200).json({ ok: true, deleted: orgId })
    }

    if (req.method === 'POST') {
      const token = process.env.VEHICLE_OPS_TOKEN
      if (token && req.headers['x-api-key'] !== token) {
        return res.status(401).json({ error: 'invalid api key' })
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const buses = Array.isArray(body.buses) ? body.buses : []
      const affs = Array.isArray(body.affiliations) ? body.affiliations : []
      const { date, recordedAt } = parseAt(body.at)
      // 配属登记：在线营运状态 / 待发计划确定的 公司 + 配属线路，只更新累计表的 line_no/company，
      // 不计超速/发车，不进按日表（避免按日视图混入低速/待发车辆）
      let affiliated = 0
      if (affs.length) {
        const rows = affs.filter((a) => a && a.orgId).map((a) => ({
          org_id: String(a.orgId), line_no: String(a.lineNo || ''), company: String(a.company || ''),
        }))
        if (rows.length) {
          await sql.query(`INSERT INTO vehicle_ops (org_id, line_no, company, online_at, offline_at, updated_at)
            SELECT b.org_id, b.line_no, b.company, $2, $2, now()
            FROM jsonb_to_recordset($1::jsonb) AS b(org_id TEXT, line_no TEXT, company TEXT)
            ON CONFLICT (org_id) DO UPDATE SET
              line_no = COALESCE(NULLIF(EXCLUDED.line_no, ''), vehicle_ops.line_no),
              company = COALESCE(NULLIF(EXCLUDED.company, ''), vehicle_ops.company),
              updated_at = now()`, [JSON.stringify(rows), `${date} ${recordedAt}`])
          affiliated = rows.length
        }
      }
      if (!buses.length) return res.status(200).json({ ok: true, upserted: 0, affiliated })
      // 回填历史快照时只写按日表，避免把历史数据重复累加进累计表 vehicle_ops
      const dailyOnly = body.dailyOnly === true

      // 整轮 2 条批量 SQL，替代旧的逐车 2N 条串行写入
      const upserted = await upsertBuses(sql, buses, { date, recordedAt, dailyOnly })
      return res.status(200).json({ ok: true, upserted, affiliated })
    }

    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) })
  }
}
