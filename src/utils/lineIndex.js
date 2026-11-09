/**
 * 线路号本地索引
 *
 * 数据来源：
 *   - src/static/lines.json         集团线路，由 scripts/scan-lines.mjs 枚举官方 /line 生成
 *   - src/static/foreign-lines.json 非集团线路（蔡城 C / 木兰 P / 汉奇），
 *                                   由 scripts/scan-foreign.mjs 经高德公交接口离线采集
 * 两者恒定合并进检索池（不设开关，默认全部可查询搜索）。
 * 非集团线路只有静态站点与走向，realtime=false。
 *
 * 库里的 `no` 是**真实线路号**，`code` 才是后端 lineCode（电1 的 lineCode 是 1001）。
 * 查询用 code，展示用 no。
 */
import DB from '../static/lines.json'
import FDB from '../static/foreign-lines.json'
import { companyKeyOfNo } from './companies.js'

/** 线路库总条数 / 生成时间（页面可直接展示） */
export const LINE_COUNT = DB.count
export const LINE_UPDATED = DB.updated
/** 当前生效的线路总数（开关开启时含非集团线路），随设置变化 */
export function lineCount() { return pool().length }

/** 全角数字/字母 → 半角，并统一大写、去掉空白与连接符（"电 1" / "ｋ１" / "K-1" 都能命中） */
const FW = '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ'
const HW = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export function normNo(s) {
  let out = ''
  for (const ch of String(s == null ? '' : s)) {
    const i = FW.indexOf(ch)
    out += i >= 0 ? HW[i] : ch
  }
  return out.replace(/[\s\-_.·]/g, '').toUpperCase()
}

// 预计算索引，避免每次输入都遍历原始字段
// key = 线路号（唯一，必有）；alt = 描述名（D 线很多是“起点-终点”，顺带支持按站名搜）
// status = 静态基座（scan-lines.mjs 落盘：停运/营运）；early/last 供 lineStatus() 实时判「营运中 / 已收班」
const INDEX = DB.lines.map((l) => ({
  no: l.no,
  code: l.code || l.no,
  name: l.name,
  key: normNo(l.no),
  alt: normNo(l.name === l.no ? '' : l.name),
  start: l.start || '',
  end: l.end || '',
  stops: l.stops || 0,
  dirs: l.dirs || [0],
  price: l.price || '',
  status: l.status || (l.stops ? '营运' : '停运'),
  // 停运依据（人工核查，仅停运线有值）：公告 / 人工确认 / 接口推断 / 待复核
  statusSource: l.statusSource || '',
  stopDate: l.stopDate || '',
  statusNote: l.statusNote || '',
  early: l.early || '',
  last: l.last || '',
  // 所属营运公司全名（scan-org.mjs 自 8684 采集；D 线等未收录为空）
  org: l.org || '',
  order: /^\d+$/.test(l.no) ? Number(l.no) : Number((l.no.match(/\d+$/) || [0])[0]) + 100000,
}))

// 非集团线路：字段与 INDEX 对齐，另带 companyKey / sourceType / realtime 供 UI 区分
const FOREIGN_INDEX = ((FDB && FDB.lines) || []).map((l) => ({
  no: l.no,
  code: l.code || l.no,
  name: l.name || l.no,
  key: normNo(l.no),
  alt: normNo(l.name === l.no ? '' : l.name),
  start: l.start || '',
  end: l.end || '',
  stops: l.stops || 0,
  dirs: l.dirs || [0],
  price: l.price || '',
  status: l.status || '营运',
  statusSource: '',
  stopDate: '',
  statusNote: '',
  early: l.early || '',
  last: l.last || '',
  org: l.org || '',
  companyKey: l.companyKey || companyKeyOfNo(l.no),
  sourceType: l.sourceType || 'amap',
  realtime: l.realtime === true,
  order: 200000 + Number((String(l.no).match(/\d+/) || [0])[0]),
}))

// 全站检索池：集团全量 + 非集团线路，恒定合并（不再有开关）
const POOL = INDEX.concat(FOREIGN_INDEX)
function pool() {
  return POOL
}

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t == null ? '' : t).trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/**
 * 线路运行状态三态判定（徽标用）：静态基座 status + 首末班时间，结合当前时刻实时算出。
 *   已停运：线路库探测不到站点数据（status==='停运'）——已从营运线网撤下；
 *   已收班：仍属营运线网，但当前时刻不在 [首班, 末班] 区间（支持跨零点夜班）；
 *   营运中：营运线且此刻处于运营时段；缺首末班时间时保守判为营运中。
 * 兼容线路库记录（status/early/last）与后端返回（stopCount/earlyHour/lastHour）两种字段名。
 * @param {Object} line 线路记录
 * @param {Date} now 判定时刻，默认当前时间
 * @returns {{key:'off'|'ended'|'live', label:string}}
 */
export function lineStatus(line, now = new Date()) {
  if (!line) return { key: 'live', label: '营运中' }
  const stops = line.stops != null ? line.stops : line.stopCount
  const isOff = line.status === '停运' || (!line.status && !stops)
  if (isOff) return { key: 'off', label: '已停运' }
  const em = toMin(line.early != null ? line.early : line.earlyHour)
  const lm = toMin(line.last != null ? line.last : line.lastHour)
  if (isNaN(em) || isNaN(lm)) return { key: 'live', label: '营运中' }
  const mins = now.getHours() * 60 + now.getMinutes()
  const inWindow = em <= lm ? (mins >= em && mins <= lm) : (mins >= em || mins <= lm)
  return inWindow ? { key: 'live', label: '营运中' } : { key: 'ended', label: '已收班' }
}

/**
 * 按关键词联想线路
 * 打分：线路号 完全相等 > 前缀 > 包含；描述名命中排在线路号之后。同分按编号大小排（数字优先）
 * @param {string} kw 用户输入
 * @param {number} limit 最多返回条数
 * @returns {Array<{no,code,name,start,end,stops,dirs}>}
 */
export function suggestLines(kw, limit = 8) {
  const q = normNo(kw)
  if (!q) return []
  const hits = []
  for (const l of pool()) {
    let score = 0
    if (l.key === q) score = 1000
    else if (l.key.startsWith(q)) score = 800 - Math.min(60, l.key.length - q.length)
    else if (l.key.includes(q)) score = 500 - Math.min(60, l.key.indexOf(q))
    else if (l.alt && l.alt === q) score = 400
    else if (l.alt && l.alt.includes(q)) score = 300 - Math.min(60, l.alt.indexOf(q))
    if (score) hits.push({ l, score })
  }
  hits.sort((a, b) => b.score - a.score || a.l.order - b.l.order || a.l.key.localeCompare(b.l.key))
  return hits.slice(0, limit).map((h) => h.l)
}

/** 关键词命中的总条数（用于显示"共 N 条相关线路"） */
export function countMatches(kw) {
  const q = normNo(kw)
  if (!q) return 0
  let n = 0
  for (const l of pool()) if (l.key.includes(q) || (l.alt && l.alt.includes(q))) n++
  return n
}

/** 精确查一条线路（集团 + 开关开启时的非集团线路） */
export function findLine(no) {
  const q = normNo(no)
  if (!q) return null
  const hit = pool().find((l) => l.key === q)
  return hit || null
}

/** 非集团线路信息（供实时视图判断是否只展示静态站点） */
export function foreignLineOf(no) {
  const q = normNo(no)
  if (!q) return null
  return FOREIGN_INDEX.find((l) => l.key === q) || null
}

/**
 * 全量线路（供「线路数据库」页浏览）：直接返回预计算索引数组（只读，勿修改）。
 * 每项含 no/code/name/start/end/stops/dirs/status/early/last 及停运依据 statusSource/stopDate/statusNote。
 */
export function allLines() {
  return pool()
}

/** 线路号前缀归类：电 / BRT / K / D / YX / C / P / 汉奇 / 数字（YX = 集团夜行线） */
export function linePrefix(no) {
  const m = /^(BRT|YX|电|K|D|C|P|汉奇)/i.exec(String(no == null ? '' : no))
  return m ? m[1].toUpperCase() : '数字'
}

