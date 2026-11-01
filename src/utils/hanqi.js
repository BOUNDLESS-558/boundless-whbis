/**
 * 汉奇智慧出行 公交数据适配器
 * --------------------------------------------------------------------------
 * 数据源：https://hanqizhihuichuxing.top/api/bus/...
 * 与武汉公交（customized.wuhanbus.com）是完全独立的一套接口，数据模型不同：
 *   - 不需要 MD5 反算，车辆 / 线路编号直接明文返回
 *     （busId 即车辆自编号，如 460C32D0；这正是武汉公交接口里缺失的「车型编号」）
 *   - 站点坐标同时给 GCJ-02（lat/lng，与本项目地图同投影）与 WGS-84（wgsLat/wgsLng）
 *   - 直接给线路 polyline（贴路轨迹，免 OSRM 吸附）、实时车辆经纬度、发车计划 scheduleTimes
 *
 * 端点（均已实测）：
 *   - /bus/nearby?lat&lng&radius   周边线路（含每条线的方向、最近站、起讫/首末班）
 *   - /bus/realtime?lineId         线路全量：stations + polyline + scheduleTimes + 实时 buses
 *
 * CORS：服务器按请求 Origin 回显 Access-Control-Allow-Origin，H5 浏览器可直连（无需反代）。
 */
const BASE = 'https://hanqizhihuichuxing.top/api/bus'

function req(path, params = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE + path,
      method: 'GET',
      data: params,
      timeout: 15000,
      success: (res) => {
        const p = res.data
        if (p && p.code === 200) resolve(p.data)
        else reject(new Error((p && p.msg) || '汉奇接口请求失败'))
      },
      fail: (e) => reject(new Error((e && e.errMsg) || '网络错误')),
    })
  })
}

/**
 * 周边线路：把 nearby 的 buses 按 lineId 合并成线路摘要（去重）。
 * 注意 nearby 字段里没有起讫站，起讫站要等 fetchLine 才知道。
 * @returns {Array<{lineId,lineName,lineNo,first,last,price,dirs:string[]}>}
 */
export async function fetchNearby(lat, lng, radius = 5000) {
  const data = await req('/nearby', { lat, lng, radius })
  const buses = (data && data.buses) || []
  const map = {}
  for (const b of buses) {
    const id = b.lineId
    if (!id) continue
    if (!map[id]) {
      map[id] = {
        lineId: id,
        lineName: b.routeName,
        lineNo: b.routeName,
        first: b.firstTime || '',
        last: b.lastTime || '',
        price: b.price || '',
        dirs: new Set(),
      }
    }
    if (b.directionCode) map[id].dirs.add(b.directionCode)
  }
  return Object.values(map).map((l) => ({ ...l, dirs: [...l.dirs] }))
}

// 武汉锚点：在没有「附近」上下文（如线路库）时，用散点覆盖全市枚举汉奇线路
const WH_ANCHORS = [
  [30.592, 114.305], // 汉口 / 江汉路
  [30.55, 114.35], // 武昌站
  [30.66, 114.42], // 青山
  [30.45, 114.18], // 沌口 / 汉阳
  [30.62, 114.05], // 蔡甸方向
  [30.7, 114.5], // 光谷 / 东湖高新
  [30.4, 114.3], // 汉南方向
]

/**
 * 拉取汉奇线路库：合并各锚点的周边结果并去重（仅 7 个轻量请求）。
 * 也可传入额外中心点（如用户当前地图视野中心）一起扫描。
 * @param {Array<[number,number]>} [extra] 附加扫描中心
 * @returns {Promise<Array>} 线路摘要数组
 */
export async function fetchHanqiLines(extra = []) {
  const all = {}
  const centers = WH_ANCHORS.concat(extra || [])
  await Promise.all(
    centers.map(([la, ln]) =>
      fetchNearby(la, ln, 6000)
        .then((arr) => arr.forEach((l) => { all[l.lineId] = l }))
        .catch(() => {})
    )
  )
  return Object.values(all)
}

/**
 * 线路详情（站点 + 贴路轨迹 + 发车计划），归一化为本项目双方向结构可用的形态。
 * 汉奇实时接口一次返回单向（start→end）的 stations / polyline；反向由调用方反转。
 * @returns {Promise<{lineId,lineName,start,end,first,last,price,realData,scheduleTimes,stations,polyline}>}
 */
export async function fetchLine(lineId) {
  const data = await req('/realtime', { lineId })
  const stations = (data.stations || []).map((s) => ({
    name: s.name,
    latitude: s.lat,
    longitude: s.lng,
    order: s.order,
  }))
  const polyline = (data.polyline || []).map((p) => ({ latitude: p.lat, longitude: p.lng }))
  return {
    lineId,
    lineName: data.lineName,
    start: data.startStation,
    end: data.endStation,
    first: data.firstTime,
    last: data.lastTime,
    price: data.price,
    realData: data.realData,
    scheduleTimes: data.scheduleTimes || [],
    stations,
    polyline,
  }
}

/**
 * 实时车辆（已含经纬度与沿线下标）。busId 为明文车辆编号。
 * @returns {Promise<{stations,polyline,realData,buses:Array}>}
 */
export async function fetchRealtime(lineId) {
  const data = await req('/realtime', { lineId })
  return {
    stations: data.stations || [],
    polyline: data.polyline || [],
    realData: data.realData,
    buses: (data.buses || []).map((b) => ({
      busId: b.busId,
      lat: b.lat,
      lng: b.lng,
      stationIndex: b.stationIndex,
      floatIndex: b.floatIndex,
      stationName: b.stationName,
      terminalTip: b.terminalTip,
      etaByOrder: b.etaByOrder || {},
      distanceByOrder: b.distanceByOrder || {},
    })),
  }
}
