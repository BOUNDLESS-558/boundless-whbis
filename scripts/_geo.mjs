/**
 * 共享 geo 工具：供 OSRM 诊断探针（probe-osrm-legs / probe-nearest / probe-roadfit）复用，
 * 避免三份完全相同的 GCJ-02/WGS-84 互转与最大垂距算法。
 * 与 src/utils/geo.js 的 wgs84ToGcj02 / gcj02ToWgs84 / 球面距离 同算法。
 */
const A = 6378245.0
const EE = 0.00669342162296594323
const PI = Math.PI
const R = 6371000

export function wgs84ToGcj02(lat, lng) {
  const outOfChina = (lon, la) => lon < 72.004 || lon > 137.8347 || la < 0.8293 || la > 55.8271
  const tLat = (x, y) => {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
    ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
    ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
    return ret
  }
  const tLng = (x, y) => {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
    ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
    ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300 * Math.sin((x * PI) / 30.0)) * 2.0) / 3.0
    return ret
  }
  if (outOfChina(lng, lat)) return { lat, lng }
  let dLat = tLat(lng - 105.0, lat - 35.0)
  let dLng = tLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)
  return { lat: lat + dLat, lng: lng + dLng }
}

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

// 接受 {lat,lng} 对象（与 roadfit 一致）；legs/nearest 原 (lat1,lng1,lat2,lng2) 改为传对象
export function haversine(a, b) {
  const toRad = (d) => (d * PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function toMeters(p, lat0, lng0) {
  return {
    x: (p.lng - lng0) * 111320 * Math.cos((lat0 * PI) / 180),
    y: (p.lat - lat0) * 110540,
  }
}

export function maxExcursion(pts, a, b) {
  if (!Array.isArray(pts) || pts.length < 2) return Infinity
  const lat0 = (a.lat + b.lat) / 2
  const lng0 = (a.lng + b.lng) / 2
  const A0 = toMeters(a, lat0, lng0)
  const B0 = toMeters(b, lat0, lng0)
  const dx = B0.x - A0.x
  const dy = B0.y - A0.y
  const len2 = dx * dx + dy * dy
  let max = 0
  for (const p of pts) {
    const P = toMeters(p, lat0, lng0)
    let t = len2 ? ((P.x - A0.x) * dx + (P.y - A0.y) * dy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(P.x - (A0.x + t * dx), P.y - (A0.y + t * dy))
    if (d > max) max = d
  }
  return max
}
