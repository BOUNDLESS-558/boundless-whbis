/**
 * 线路静态资产（站点明细 + 离线算好的走向几何）懒加载
 *
 * 资产由 `npm run scan:routes` 生成在 src/static/lines/，按线路号哈希分成 64 个分片。
 * 为什么不进 lines.json：3~5 万条站点明细会让首屏 bundle 膨胀十几倍（AGENTS.md / cityBus.js
 * 已有同样结论），放 static 走 HTTP 缓存、按需取分片才不拖首屏。
 *
 * 缓存策略与 cityBus.js 的线网底图一致：只留内存（含 in-flight Promise 去重），
 * 不进 localStorage（文件本身已被 HTTP 缓存，落盘会顶满配额）。
 * 资产缺失 / 404 / 解析失败一律返回 null，调用方回退实时 /line + OSRM，不影响主流程。
 */
import { assetUrl } from './asset.js'
import { shardOf } from './routeClean.js'

const ASSET_DIR = '/static/lines/'
const SHARDS = new Map()

function safeJson(s) {
  try { return JSON.parse(s) } catch (e) { return null }
}

/** 取一个分片；并发调用同一分片只发一次请求 */
export function loadShard(no) {
  const key = shardOf(no)
  if (SHARDS.has(key)) return SHARDS.get(key)
  const p = new Promise((resolve) => {
    uni.request({
      url: assetUrl(ASSET_DIR + key + '.json'),
      method: 'GET',
      timeout: 15000,
      success: (res) => {
        const body = res && res.statusCode === 200 ? res.data : null
        const data = body && typeof body === 'string' ? safeJson(body) : body
        if (!data || typeof data !== 'object' || !data.lines) {
          SHARDS.delete(key)
          resolve(null)
          return
        }
        resolve(data)
      },
      fail: () => { SHARDS.delete(key); resolve(null) },
    })
  })
  SHARDS.set(key, p)
  return p
}

/**
 * 取一条线路的资产：{ no, dirs: { 0:{base,stops,route,snapped}, 1:{...} } }
 * 没有资产返回 null。
 */
export async function loadLineAsset(no) {
  const key = String(no == null ? '' : no).trim()
  if (!key) return null
  const shard = await loadShard(key)
  const row = shard && shard.lines && shard.lines[key]
  return row && row.dirs ? row : null
}

/** 取指定方向的资产行，键可能是数字或字符串 */
export function assetDir(row, dir) {
  if (!row || !row.dirs) return null
  return row.dirs[String(dir)] || row.dirs[dir] || null
}

export default { loadShard, loadLineAsset, assetDir }
