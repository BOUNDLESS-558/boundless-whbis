/**
 * 全站分页工具：页码算法 + 用户可选的每页条数（10/20/50/100）
 * 数据面板与线路库共用，避免两处各写一套翻页逻辑。
 */
export const PAGE_SIZE_OPTS = [10, 20, 50, 100]
const PAGE_SIZE_KEY = 'whbis:page-size'

export function getPageSize() {
  try {
    const n = Number(uni.getStorageSync(PAGE_SIZE_KEY))
    if (PAGE_SIZE_OPTS.includes(n)) return n
  } catch (e) { /* 存储不可用走默认 */ }
  return 20
}
export function setPageSize(n) {
  const v = PAGE_SIZE_OPTS.includes(Number(n)) ? Number(n) : 20
  try { uni.setStorageSync(PAGE_SIZE_KEY, v) } catch (e) { /* 忽略 */ }
  return v
}
export function pageCount(total, size) {
  return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / Math.max(1, Number(size) || 20)))
}
/** 页码按钮：首末页 + 当前页邻域，中间用 '…' 省略 */
export function pageList(count, current) {
  const n = Math.max(1, Number(count) || 1)
  const cur = Math.max(1, Number(current) || 1)
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  const out = [1]
  const from = Math.max(2, cur - 1)
  const to = Math.min(n - 1, cur + 1)
  if (from > 2) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < n - 1) out.push('…')
  out.push(n)
  return out
}
export function clampPage(page, count) {
  const n = Math.max(1, Number(count) || 1)
  return Math.min(Math.max(1, Number(page) || 1), n)
}
export default { PAGE_SIZE_OPTS, getPageSize, setPageSize, pageCount, pageList, clampPage }
