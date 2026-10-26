/**
 * 线路号本地索引
 *
 * 数据来源：`scripts/scan-lines.mjs` 枚举官方 /line 接口生成（src/data/lines.json）。
 * 白名单口径：纯数字 + 电 / BRT / K / D 四种前缀（本集团营运线路）。
 * 库里的 `no` 是按 lineName 归一后的**真实线路号**，`code` 才是后端 lineCode
 * （两者偶尔不同：电1 的 lineCode 是 1001）。查询用 code，展示用 no。
 */
import DB from '../data/lines.json'

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
  order: /^\d+$/.test(l.no) ? Number(l.no) : Number((l.no.match(/\d+$/) || [0])[0]) + 100000,
}))

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
  for (const l of INDEX) {
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
  for (const l of INDEX) if (l.key.includes(q) || (l.alt && l.alt.includes(q))) n++
  return n
}

/** 精确查一条（用于校验用户输入是否在库内） */
export function findLine(no) {
  const q = normNo(no)
  if (!q) return null
  const hit = INDEX.find((l) => l.key === q)
  return hit || null
}
