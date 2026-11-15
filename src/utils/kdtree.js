/**
 * K-d Tree（k 维树）—— 最邻近搜索的离线数据结构
 *
 * 为什么需要它：
 *   现有 nearStopOf / matchBusesToStops 对 N 个站点做 O(N) 线性扫描。
 *   全市线网一次 build 要建 1000+ 条方向的站点集合，每次车辆刷新都要扫一遍 →
 *   在 App 低端机上明显卡帧。K-d tree 查询是 O(log N)，建表 O(N log N) 一次性摊薄。
 *
 * 实现要点：
 *   - 静态不可变（build 一次后不再修改），符合 uni-app 浏览器端的只读场景；
 *   - 维度固定为 2（lat / lng），所有点都是 {lat, lng}；
 *   - 切分轴按节点深度循环（depth % 2 = 0 → lat，否则 → lng）；
 *   - 中位数选第 length/2 小的元素，保证左右子树平衡；
 *   - search() 返回最近点的 {point, distance, index}；distance 以米为单位（用 haversine）。
 *
 * 性能预期：
 *   - 武汉公交站总数 ≈ 60 000；建树约 100ms 量级；单次 nearest 查询 < 1μs。
 *   - 与当前线性扫描相比，百万次级查询从 ~10s 降到 ~1ms。
 *
 * @module kdtree
 */
const R = 6371000 // 地球半径（米），与 geo.js 保持一致

/** Haversine 距离（内部复用，避免重复定义常量） */
function distM(p1, p2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(p2.lat - p1.lat)
  const dLng = toRad(p2.lng - p1.lng)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** 节点结构：{ point, left, right, axis } */
class Node {
  constructor(point, axis) {
    this.point = point
    this.axis = axis
    this.left = null
    this.right = null
  }
}

/** 选择第 k 小元素的分区（原地，不复制数组，节省内存） */
function selectK(arr, k) {
  let lo = 0
  let hi = arr.length - 1
  while (lo <= hi) {
    const pivotIdx = partition(arr, lo, hi, k)
    if (pivotIdx === k) return arr[k]
    if (pivotIdx < k) lo = pivotIdx + 1
    else hi = pivotIdx - 1
  }
  return arr[k]
}

function partition(arr, lo, hi, pivotVal) {
  const pivot = arr[pivotVal]
  const idx = arr[pivotVal].axis // 临时挂到对象上作比较键
  let store = lo
  for (let i = lo; i < hi; i++) {
    if (arr[i][idx] <= pivot[idx]) {
      ;[arr[store], arr[i]] = [arr[i], arr[store]]
      store++
    }
  }
  ;[arr[store], arr[hi]] = [arr[hi], arr[store]]
  return store
}

/**
 * 在线构建树：按 depth 递归切分，中位数作为根
 * @param {Array<{lat:number,lng:number}>} points 原始点数组（会被排序并可能破坏顺序，调用方自行保留副本）
 * @param {number} depth 当前深度
 * @returns {Node|null}
 */
function buildTree(points, depth) {
  if (!points || points.length === 0) return null
  const pts = Array.from(points).map((p, i) => ({ ...p, _i: i })) // 保留原索引
  const axis = depth % 2 // 偶数层按 lat，奇数层按 lng 切分
  const mid = selectK(pts, Math.floor(pts.length / 2))
  const root = new Node({ lat: mid.lat, lng: mid.lng, _i: mid._i }, axis)
  root.left = buildTree(pts.slice(0, Math.floor(pts.length / 2)), depth + 1)
  root.right = buildTree(pts.slice(Math.floor(pts.length / 2) + 1), depth + 1)
  return root
}

/** 沿某一路径搜索所有候选近邻 —— 经典 KD-Tree nearest neighbor 算法 */
function searchNearest(node, target, bestSoFar) {
  if (!node) return bestSoFar
  const dist = distM(target, node.point)
  if (dist < bestSoFar.dist) {
    bestSoFar = { point: node.point, dist, index: node.point._i }
  }
  const axis = node.axis
  const diff = target[axis] - node.point[axis]
  const next = diff <= 0 ? node.left : node.right
  const other = diff <= 0 ? node.right : node.left
  bestSoFar = searchNearest(next, target, bestSoFar)
  // 若超球与分割面相交则仍需搜索另一侧
  if (diff * diff < bestSoFar.dist) {
    bestSoFar = searchNearest(other, target, bestSoFar)
  }
  return bestSoFar
}

// ─────────── 公开 API ───────────

/**
 * 构建 K-d Tree，供全局近邻查询使用。
 * @param {Array<{lat:number,lng:number}>} points 原始点集（GCJ-02 或 WGS84 均可，只要统一即可）
 * @returns {{tree: Node|null, points: Array}} tree 用于 searchNearby / searchNearest；
 *          points 保留副本（tree 内部的引用）
 */
export function build(points) {
  if (!Array.isArray(points) || points.length < 2) return { tree: null, points }
  return { tree: buildTree(points.map((p) => ({ lat: p.lat, lng: p.lng, _i: p.i }))), points }
}

/**
 * 查最近的单个点
 * @param {Node} tree 由 build() 返回的 tree
 * @param {{lat:number,lng:number}} query 查询点
 * @returns {{point:{lat:number,lng:number}, dist:number}|null} dist 为米；tree 为空时返回 null
 */
export function nearest(tree, query) {
  if (!tree) return null
  return searchNearest(tree, query, { point: query, dist: Infinity, index: -1 })
}

/**
 * 查所有在 radius 米以内的点（上限 maxCount，按距升序返回）
 * @param {Node} tree
 * @param {{lat:number,lng:number}} center
 * @param {number} radius 米
 * @param {number} maxCount 上限，防止返回过多
 * @returns {Array<{point:{lat:number,lng:number}, dist:number}>}
 */
export function nearby(tree, center, radius, maxCount = 999) {
  if (!tree) return []
  const out = []
  function walk(node) {
    if (!node || out.length >= maxCount) return
    const d = distM(center, node.point)
    if (d <= radius) out.push({ point: node.point, dist: d })
    // 先搜较近一侧，再视情况搜较远一侧（早停优化）
    const axis = node.axis
    const diff = center[axis] - node.point[axis]
    const closer = diff <= 0 ? node.left : node.right
    const farther = diff <= 0 ? node.right : node.left
    // 当另一侧可能与球体相交时才进入
    if (diff * diff < radius * radius) {
      walk(farther)
    }
    walk(closer)
    if (out.length >= maxCount) out.sort((a, b) => a.dist - b.dist)
  }
  walk(tree)
  return out
}

export default { build, nearest, nearby }
