/**
 * 营运公司字典与线路归属（全站唯一真源）
 *
 * 武汉公交系统不止「武汉公交集团」一家：还有蔡城 / 木兰 / 汉奇等独立营运主体。
 * 它们的站点与走向来自高德公交信息接口（离线采集，运行时零调用），
 * 资产分片按「公司缩写 + B + 数字」命名，与集团的 bNN.json 分开存，便于区分。
 *
 * 站点 stopId：高德返回的是 BV... 开头的 ID（正是历史口径里的「B 开头」）。
 * 非集团线路落盘时改写为 `${abbr}B${序号}`（如 CCB0001），并保留 originId 备查，
 * 这样同一张表里一眼能看出站点属于哪家公司，也不会与集团站号冲突。
 */
export const COMPANIES = {
  JT: {
    abbr: 'JT', assetPrefix: 'b', name: '武汉公交集团', short: '公交集团',
    // 集团徽标用官方蓝色 e 标（static/logo.png），与品牌行 / favicon 同一张图；
    // 不再用旧的 logo-jt.svg（靛蓝方块 + 公交简笔画），保持全站品牌一致
    color: '#6366f1', logo: '/static/logo.png', prefixRe: /^(\d|电|BRT|K|D|YX)/i,
  },
  CC: {
    abbr: 'CC', assetPrefix: 'CCB', name: '武汉蔡城公交客运公司', short: '蔡城公交',
    color: '#f59e0b', logo: '/static/logo-cc.svg', prefixRe: /^C\d/i,
    amapNames: [/蔡城/, /蔡甸/],
  },
  ML: {
    abbr: 'ML', assetPrefix: 'MLB', name: '武汉木兰公交客运公司', short: '木兰公交',
    color: '#10b981', logo: '/static/logo-ml.svg', prefixRe: /^P\d/i,
    amapNames: [/木兰/, /黄陂/],
  },
  HQ: {
    abbr: 'HQ', assetPrefix: 'HQB', name: '汉奇智慧出行', short: '汉奇公交',
    color: '#a855f7', logo: '/static/logo-hq.svg', prefixRe: /^(汉奇|HQ)/i,
    amapNames: [/汉奇/],
  },
}

/** 集团各营运公司（org 全名 → 短标签），沿用线路库既有口径 */
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 线路号 → 公司 key（非集团线路靠号段前缀判定，集团一律 JT） */
export function companyKeyOfNo(no) {
  const s = String(no == null ? '' : no).trim()
  if (!s) return 'JT'
  for (const k of ['CC', 'ML', 'HQ']) {
    if (COMPANIES[k].prefixRe.test(s)) return k
  }
  return 'JT'
}

/** org 全名（集团第一…第九营运公司，或非集团全称）→ {key,label,full,color,logo} */
export function orgInfo(line) {
  const full = String((line && (line.org || line.company)) || '').trim()
  if (full) {
    for (const k of ['CC', 'ML', 'HQ']) {
      const c = COMPANIES[k]
      if (c.amapNames.some((re) => re.test(full)) || full === c.name) {
        return { key: k, label: c.short, full, color: c.color, logo: c.logo }
      }
    }
    const m = full.match(/第([一二三四五六七八九])营运公司/)
    if (m) return { key: 'JT', label: m[1] + '公司', full, color: COMPANIES.JT.color, logo: COMPANIES.JT.logo }
  }
  if (line && line.companyKey && COMPANIES[line.companyKey]) {
    const c = COMPANIES[line.companyKey]
    return { key: c.abbr, label: c.short, full: c.name, color: c.color, logo: c.logo }
  }
  return null
}

/**
 * 线路 → 公司徽标信息（全站展示统一出口，永不返回 null）。
 *
 * 本函数是筛选与展示的共同出口：集团线路即使 org 字段缺失（大量停运/历史线）
 * 也返回集团徽标，保证线路库、搜索联想、收藏夹每一行都有 Logo。
 * 集团下属第一…第九营运公司只作为 org/full 保留（详情与导出用），对外统一归 JT，
 * 不拆成一公司/二公司这类会被误解为独立公司的分类。
 * 非集团线路优先按号段判定，不依赖 org/companyKey 是否已回填。
 */
export function companyOf(line) {
  const l = line || {}
  const byNo = companyKeyOfNo(l.no)
  const key = (l.companyKey && l.companyKey !== 'JT' && COMPANIES[l.companyKey]) ? l.companyKey : byNo
  if (key !== 'JT') {
    const c = COMPANIES[key]
    return { key: c.abbr, label: c.short, full: c.name, color: c.color, logo: c.logo }
  }
  const jt = COMPANIES.JT
  const full = String(l.org || l.company || '').trim()
  // 从 org 全名里提取集团下属具体营运公司（第一…第九营运公司），让收藏夹/列表能区分
  const m = full.match(/第([一二三四五六七八九])营运公司/)
  const specific = m ? m[1] + '营运公司' : ''
  return {
    key: 'JT',
    // 集团线默认显示「公交集团」；若 org 里带具体营运公司（如「第三营运公司」）则一并显示，
    // 免得收藏夹里一堆 JT 线全挤在同一个「公交集团」标签下无法区分
    label: specific ? jt.short + '·' + specific : jt.short,
    full: full || jt.name,
    color: jt.color,
    logo: jt.logo,
  }
}

/** 非集团线路资产分片名：公司缩写 + B + 两位桶号（FNV-1a，8 桶） */
export function foreignShardOf(no, abbr) {
  const s = String(no == null ? '' : no).trim()
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return `${abbr}B${String(((h >>> 0) % 8) + 1).padStart(2, '0')}`
}

/** 线路是否为「非集团」（前端据此决定是否显示静态数据标注 / 公司徽标） */
export function isForeign(line) {
  if (!line) return false
  if (line.companyKey && line.companyKey !== 'JT') return true
  if (line.sourceType && line.sourceType !== 'wuhanbus') return true
  return companyKeyOfNo(line.no) !== 'JT'
}

export const COMPANY_LIST = Object.values(COMPANIES)
export const CN_COMPANY = CN
export default COMPANIES
