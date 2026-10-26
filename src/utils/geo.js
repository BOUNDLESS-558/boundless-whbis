/**
 * 地理计算工具
 * 用于把实时车辆 GPS 坐标匹配到最近站点
 */

/** 地球半径（米） */
const R = 6371000

/**
 * WGS84（GPS原始坐标）转 GCJ-02（国测局/高德火星坐标）
 * ⚠注意：实测确认武汉公交 API 返回的站点/车辆坐标已经是 GCJ-02（与高德官方线路轨迹平均仅偏差 ~18m），
 *   直接上高德地图即可，切勿再调用本函数二次转换（否则整体偏移数百米、站点错位）。
 *   本函数保留仅供确实持有 WGS84 原始坐标的场景参考。
 * @param {number} lat WGS84 纬度
 * @param {number} lng WGS84 经度
 * @returns {{lat: number, lng: number}} GCJ-02 坐标
 */
export function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0 // 克拉索夫斯基椭球长半轴
  const ee = 0.00669342162296594323 // 偏心率平方
  const pi = Math.PI

  const outOfChina = (lon, la) => lon < 72.004 || lon > 137.8347 || la < 0.8293 || la > 55.8271
  const transformLat = (x, y) => {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    ret += ((20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0) / 3.0
    ret += ((20.0 * Math.sin(y * pi) + 40.0 * Math.sin((y / 3.0) * pi)) * 2.0) / 3.0
    ret += ((160.0 * Math.sin((y / 12.0) * pi) + 320 * Math.sin((y * pi) / 30.0)) * 2.0) / 3.0
    return ret
  }
  const transformLng = (x, y) => {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    ret += ((20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0) / 3.0
    ret += ((20.0 * Math.sin(x * pi) + 40.0 * Math.sin((x / 3.0) * pi)) * 2.0) / 3.0
    ret += ((150.0 * Math.sin((x / 12.0) * pi) + 300.0 * Math.sin((x / 30.0) * pi)) * 2.0) / 3.0
    return ret
  }

  if (outOfChina(lng, lat)) return { lat, lng }
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * pi
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * pi)
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * pi)
  return { lat: lat + dLat, lng: lng + dLng }
}

/**
 * GCJ-02（国测局/高德火星坐标）反解为 WGS84（GPS 原始坐标）
 * 用途：OSRM 等海外路网服务只认 WGS84，必须先解偏再查询；
 *   而武汉公交 API 与高德瓦片都是 GCJ-02，查询结果还要再转回来才能对齐。
 * 做法：用正向公式迭代逼近（3 次即可把残差压到厘米级），无需反解多项式。
 * @param {number} lat GCJ-02 纬度
 * @param {number} lng GCJ-02 经度
 * @returns {{lat: number, lng: number}} WGS84 坐标
 */
export function gcj02ToWgs84(lat, lng) {
  let wLat = lat
  let wLng = lng
  for (let i = 0; i < 3; i++) {
    const g = wgs84ToGcj02(wLat, wLng)
    wLat += lat - g.lat
    wLng += lng - g.lng
  }
  return { lat: wLat, lng: wLng }
}

/**
 * 计算两点间球面距离（米）
 * @param {number} lat1 纬度1
 * @param {number} lng1 经度1
 * @param {number} lat2 纬度2
 * @param {number} lng2 经度2
 * @returns {number} 距离（米）
 */
export function distance(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * 格式化距离为易读文本
 * @param {number} meters 距离（米）
 * @returns {string} 如 "320m" / "1.2km"
 */
export function formatDistance(meters) {
  if (meters === null || meters === undefined || isNaN(meters)) return '--'
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

/**
 * 将车辆匹配到最近站点
 * @param {Array} buses 车辆数组（元素需含 lat/lng）
 * @param {Array} stops 站点数组（元素需含 latitude/longitude）
 * @returns {Object} { stopsWithBuses: Array, buses: Array }
 *   stopsWithBuses —— 每个站点附加 buses 字段（停靠该站的车辆，按距离升序）
 *   buses —— 车辆附加 nearestStopIndex / distance / distanceText
 */
export function matchBusesToStops(buses, stops) {
  const stopsWithBuses = stops.map((s) => ({ ...s, buses: [] }))
  const enriched = []

  buses.forEach((bus) => {
    if (isNaN(bus.lat) || isNaN(bus.lng)) {
      enriched.push({ ...bus, nearestStopIndex: -1, distance: null, distanceText: '--' })
      return
    }
    let best = -1
    let bestDist = Infinity
    stops.forEach((s, i) => {
      const lat = parseFloat(s.latitude)
      const lng = parseFloat(s.longitude)
      if (isNaN(lat) || isNaN(lng)) return
      const d = distance(bus.lat, bus.lng, lat, lng)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    const item = {
      ...bus,
      nearestStopIndex: best,
      distance: best === -1 ? null : bestDist,
      distanceText: formatDistance(best === -1 ? null : bestDist),
    }
    enriched.push(item)
    if (best !== -1) stopsWithBuses[best].buses.push(item)
  })

  // 每个站点内按距离由近到远
  stopsWithBuses.forEach((s) => {
    s.buses.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity))
  })

  return { stopsWithBuses, buses: enriched }
}
