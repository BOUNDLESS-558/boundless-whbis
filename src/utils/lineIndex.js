/**
 * 线路号本地索引
 *
 * 数据来源：`scripts/scan-lines.mjs` 枚举官方 /line 接口生成（src/static/lines.json）。
 * 白名单口径：纯数字 + 电 / BRT / K / D 四种前缀（本集团营运线路）。
 * 库里的 `no` 是按 lineName 归一后的**真实线路号**，`code` 才是后端 lineCode
 * （两者偶尔不同：电1 的 lineCode 是 1001）。查询用 code，展示用 no。
 */
import DB from '../static/lines.json'

/** 线路库总条数 / 生成时间（页面可直接展示） */
export const LINE_COUNT = DB.count
export const LINE_UPDATED = DB.updated

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
  early: l.early || '',
  last: l.last || '',
  // 所属营运公司全名（scan-org.mjs 自 8684 采集；D 线等未收录为空）
  org: l.org || '',
  order: /^\d+$/.test(l.no) ? Number(l.no) : Number((l.no.match(/\d+$/) || [0])[0]) + 100000,
}))

// 联想检索池 = 武汉公交全量（只喂 suggestLines / countMatches；allLines 仍只回武汉公交）
const SEARCH_INDEX = INDEX

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
  for (const l of SEARCH_INDEX) {
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
  for (const l of SEARCH_INDEX) if (l.key.includes(q) || (l.alt && l.alt.includes(q))) n++
  return n
}

/** 精确查一条武汉公交（用于校验用户输入是否在库内） */
export function findLine(no) {
  const q = normNo(no)
  if (!q) return null
  const hit = INDEX.find((l) => l.key === q)
  return hit || null
}

/**
 * 全量线路（供「线路数据库」页浏览）：直接返回预计算索引数组（只读，勿修改）。
 * 每项含 no/code/name/start/end/stops/dirs/status/early/last，足够展示本地摘要。
 */
export function allLines() {
  return INDEX
}

/** 线路号前缀归类：电 / BRT / K / D / 数字（白名单四前缀之外均为纯数字线） */
export function linePrefix(no) {
  const m = /^(电|BRT|K|D)/.exec(String(no == null ? '' : no))
  return m ? m[1] : '数字'
}

/**
 * 营运公司归类（仅武汉公交）：org 全名 → 筛选键/短标签；无 org（D 线、未收录）返回 null。
 * 集团线归为「第一公司」…「第九公司」，其余公司归「其他」，供线路库按公司筛选。
 */
export function orgOf(line) {
  const full = String((line && line.org) || '').trim()
  if (!full) return null
  const m = full.match(/第([一二三四五六七八九])营运公司/)
  return m ? { key: '第' + m[1] + '公司', label: m[1] + '公司', full } : { key: '其他', label: '其他公司', full }
}
