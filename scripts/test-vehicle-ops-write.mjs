/**
 * 离线回归：验证 /api/vehicle-ops 的批量写入改造。
 *
 * 不连真实数据库：在临时目录造一个 @neondatabase/serverless 的 mock，
 * 再把仓库里的 api/vehicle-ops.js 复制到该目录加载 —— Node 从该文件所在目录
 * 向上解析 node_modules，会命中 mock，因此测到的仍是真实 handler 源码。
 *
 * 断言重点：写库 SQL 条数与车辆数无关（优化核心）、冲突更新语义、
 * 字段归一化、orgId 去重、dailyOnly、鉴权、at 解析。
 *
 * 用法：node scripts/test-vehicle-ops-write.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'whbis-ops-test-'))
const calls = []
globalThis.__opsCalls = calls

const mockDir = path.join(TMP, 'node_modules', '@neondatabase', 'serverless')
fs.mkdirSync(mockDir, { recursive: true })
fs.writeFileSync(
  path.join(mockDir, 'package.json'),
  JSON.stringify({ name: '@neondatabase/serverless', version: '0.0.0-mock', type: 'module', main: 'index.js' }),
)
fs.writeFileSync(
  path.join(mockDir, 'index.js'),
  `export function neon() {
  const sql = async (strings, ...values) => {
    globalThis.__opsCalls.push({ kind: 'tag', text: String(strings && strings.raw ? strings.raw.join('?') : strings), params: values })
    return []
  }
  sql.query = async (text, params) => {
    globalThis.__opsCalls.push({ kind: 'query', text, params })
    return []
  }
  return sql
}
`,
)

const handlerDir = path.join(TMP, 'api')
fs.mkdirSync(handlerDir, { recursive: true })
const SRC = path.join(ROOT, 'api', 'vehicle-ops.js')
const COPY = path.join(handlerDir, 'vehicle-ops.js')
fs.copyFileSync(SRC, COPY)

process.env.DATABASE_URL = 'postgresql://mock/mock'
const mod = await import(pathToFileURL(COPY).href)
const handler = mod.default

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(o) { this.body = o; return this },
    end() { return this },
  }
}
const reqOf = (method, body, headers = {}) => ({ method, body, headers, query: {} })

function bus(i, over = {}) {
  return {
    orgId: `BUS${String(i).padStart(5, '0')}`,
    lineNo: String(337 + (i % 5)),
    company: '武汉市公共交通集团有限责任公司一营运公司',
    maxSpeed: 40 + (i % 30),
    speedCount: i % 4,
    onlineAt: '2026-11-26 08:00',
    offlineAt: '2026-11-26 15:30',
    departures: 1 + (i % 3),
    transfers: [],
    lines: [String(337 + (i % 5))],
    samples: 1,
    ...over,
  }
}

const queries = () => calls.filter((c) => c.kind === 'query')
const passed = []
const check = (name, fn) => { fn(); passed.push(name); console.log('  √ ' + name) }

try {
  console.log('=== vehicle-ops 批量写入离线回归 ===\n')

  // 1. 空数组不写库
  {
    calls.length = 0
    const res = mockRes()
    await handler(reqOf('POST', { at: '2026-11-26 15:30', buses: [] }), res)
    check('空 buses → upserted=0 且不发写库 SQL', () => {
      assert.equal(res.body.upserted, 0)
      assert.equal(queries().length, 0)
    })
  }

  // 2. 3 辆车：字段归一化 + 2 条批量 SQL + 语义
  {
    calls.length = 0
    const res = mockRes()
    await handler(reqOf('POST', {
      at: '2026-11-26 15:30',
      buses: [bus(1), bus(2, { maxSpeed: '55.5', speedCount: '3', transfers: null, lines: null }), bus(3)],
    }), res)
    const q = queries()
    const payload = JSON.parse(q[0] && q[0].params[0])
    check('3 辆车 → upserted=3，写库 SQL 恒为 2 条', () => {
      assert.equal(res.body.upserted, 3)
      assert.equal(q.length, 2)
      assert.equal(payload.length, 3)
    })
    check('字段归一化（字符串转数值、null 数组兜底）', () => {
      assert.equal(payload[1].max_speed, 55.5)
      assert.equal(payload[1].speed_count, 3)
      assert.deepEqual(payload[1].transfers, [])
      assert.deepEqual(payload[1].lines, [])
    })
    // jsonb_to_recordset 按 JSON key 匹配列名：key 写成驼峰会让字段静默变 NULL
    check('payload key 与 jsonb_to_recordset 列定义逐一对应（防静默丢字段）', () => {
      const colText = q[0].text.match(/AS b\(([\s\S]*?)\)\s*ON CONFLICT/)[1]
      const cols = new Set(colText.split(',').map((s) => s.trim().split(/\s+/)[0]))
      const keys = Object.keys(payload[0])
      for (const k of keys) assert.ok(cols.has(k), `payload key "${k}" 不在列定义中，会变 NULL`)
      for (const need of ['org_id', 'line_no', 'max_speed', 'speed_count', 'online_at', 'offline_at']) {
        assert.ok(keys.includes(need), `缺少必要列 ${need}`)
      }
      assert.equal(keys.length, cols.size)
    })
    check('累计表：累加语义与 GREATEST/LEAST 保留', () => {
      assert.match(q[0].text, /jsonb_to_recordset\(\$1::jsonb\)/)
      assert.match(q[0].text, /INSERT INTO vehicle_ops \(/)
      assert.match(q[0].text, /speed_count = vehicle_ops\.speed_count \+ EXCLUDED\.speed_count/)
      assert.match(q[0].text, /max_speed = GREATEST\(vehicle_ops\.max_speed, EXCLUDED\.max_speed\)/)
      assert.match(q[0].text, /online_at = LEAST\(vehicle_ops\.online_at, EXCLUDED\.online_at\)/)
      assert.equal(q[0].params.length, 1)
    })
    check('按日表：取当日最大值语义 + NULLIF 空值兜底 + at 解析', () => {
      assert.match(q[1].text, /INSERT INTO vehicle_ops_daily \(/)
      assert.match(q[1].text, /speed_count = GREATEST\(vehicle_ops_daily\.speed_count, EXCLUDED\.speed_count\)/)
      assert.match(q[1].text, /NULLIF\(vehicle_ops_daily\.online_at, ''\)/)
      assert.equal(q[1].params[1], '2026-11-26')
      assert.equal(q[1].params[2], '15:30')
      assert.equal(q[1].params.length, 3)
    })
  }

  // 3. 核心：2000 辆车 SQL 条数仍是 2
  {
    calls.length = 0
    const res = mockRes()
    const buses = Array.from({ length: 2000 }, (_, i) => bus(i))
    const t0 = Date.now()
    await handler(reqOf('POST', { at: '2026-11-26 15:30', buses }), res)
    const ms = Date.now() - t0
    const q = queries()
    const bytes = q.reduce((n, c) => n + String(c.params[0] || '').length, 0)
    check(`2000 辆车 → upserted=2000，SQL 仍为 2 条（旧版需 4000 条）`, () => {
      assert.equal(res.body.upserted, 2000)
      assert.equal(q.length, 2)
      assert.equal(JSON.parse(q[0].params[0]).length, 2000)
    })
    console.log(`     · 本轮 handler 耗时 ${ms}ms，批量 payload 共 ${(bytes / 1024).toFixed(1)} KiB`)
    globalThis.__stats = { buses: 2000, sqlCount: q.length, ms, bytes }
  }

  // 4. dailyOnly 只写按日表
  {
    calls.length = 0
    const res = mockRes()
    await handler(reqOf('POST', { at: '2026-11-26 15:30', buses: [bus(1)], dailyOnly: true }), res)
    check('dailyOnly=true → 只写按日表 1 条', () => {
      assert.equal(res.body.upserted, 1)
      assert.equal(queries().length, 1)
      assert.match(queries()[0].text, /INSERT INTO vehicle_ops_daily \(/)
    })
  }

  // 5. 重复 orgId 去重（批量 ON CONFLICT 不能同批撞两次）
  {
    calls.length = 0
    const res = mockRes()
    await handler(reqOf('POST', {
      at: '2026-11-26 15:30',
      buses: [bus(7), bus(7, { maxSpeed: 99 }), bus(8)],
    }), res)
    const payload = JSON.parse(queries()[0].params[0])
    check('重复 orgId → 去重且保留最后一条', () => {
      assert.equal(res.body.upserted, 2)
      assert.equal(payload.length, 2)
      assert.equal(new Set(payload.map((r) => r.org_id)).size, 2)
      assert.equal(payload.find((r) => r.org_id === 'BUS00007').max_speed, 99)
    })
  }

  // 6. 鉴权仍生效
  {
    const prev = process.env.VEHICLE_OPS_TOKEN
    process.env.VEHICLE_OPS_TOKEN = 'test-token'
    calls.length = 0
    const bad = mockRes()
    await handler(reqOf('POST', { buses: [bus(1)] }, { 'x-api-key': 'wrong' }), bad)
    const okRes = mockRes()
    await handler(reqOf('POST', { at: '2026-11-26 15:30', buses: [bus(1)] }, { 'x-api-key': 'test-token' }), okRes)
    if (prev === undefined) delete process.env.VEHICLE_OPS_TOKEN
    else process.env.VEHICLE_OPS_TOKEN = prev
    check('x-api-key 鉴权：错误 401 / 正确放行', () => {
      assert.equal(bad.statusCode, 401)
      assert.equal(okRes.body.upserted, 1)
    })
  }

  // 7. GET 档案视图未回归
  {
    calls.length = 0
    const res = mockRes()
    await handler(reqOf('GET', undefined), res)
    check('GET 档案视图仍返回 { updated, buses }', () => {
      assert.equal(res.statusCode, 200)
      assert.ok('buses' in res.body && 'updated' in res.body)
    })
  }

  const s = globalThis.__stats
  console.log(`\n=== 全部 ${passed.length} 项通过 ===`)
  console.log(`· 模拟写入：${s.buses} 辆车 × 2 张表 = ${s.buses * 2} 行记录（upsert）`)
  console.log(`· 写库 SQL：${s.sqlCount} 条（旧实现为 ${s.buses * 2} 条，减少 ${s.buses * 2 - s.sqlCount} 条）`)
  console.log('· 注意：本测试使用 mock neon，未连接真实数据库，未写入任何真实数据。')
} finally {
  fs.rmSync(TMP, { recursive: true, force: true })
}
