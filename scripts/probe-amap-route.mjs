/**
 * 探针：高德网页端「公交线路」接口里能否直接拿到精确走向折线（xs/ys）
 * 目的：若可行，就不再依赖 OSRM（OSM 武汉数据实测不可靠）
 * 用法：node scripts/probe-amap-route.mjs [线路号]
 */
const LINE_NO = process.argv[2] || '337'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const BASE_H = {
  'User-Agent': UA,
  Referer: 'https://www.amap.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

function keysOf(o) {
  if (!o || typeof o !== 'object') return typeof o
  return Object.keys(o).slice(0, 60).join(',')
}

async function tryJson(name, url) {
  try {
    const r = await fetch(url, { headers: { ...BASE_H, Accept: 'application/json, text/plain, */*' } })
    const txt = await r.text()
    console.log(`\n=== ${name} ===`)
    console.log('status', r.status, 'len', txt.length, 'ctype', r.headers.get('content-type'))
    let j = null
    try {
      j = JSON.parse(txt)
    } catch (e) {
      console.log('非 JSON，前 300 字:', txt.slice(0, 300).replace(/\s+/g, ' '))
      const hit = txt.match(/"(xs|ys|polyline|points|spoly|polyline_)"/g)
      console.log('HTML 内出现坐标字段:', hit ? [...new Set(hit)].slice(0, 10) : '无')
      return null
    }
    console.log('顶层 keys:', keysOf(j))
    return j
  } catch (e) {
    console.log(`\n=== ${name} === 失败`, e.message)
    return null
  }
}

const kw = encodeURIComponent(LINE_NO + '路')

// 1) 网页端 POI 搜索（公交线路）
const searchUrl =
  'https://www.amap.com/service/poiInfo?query_type=TQUERY&pagesize=20&pagenum=1&qii=true&cluster_state=5' +
  '&need_utd=true&utd_sceneid=1000&div=PC1000&addr_poi_merge=true&is_classify=true&zoom=12&city=420100' +
  `&geoobj=114.183559%7C30.498013%7C114.523448%7C30.679478&keywords=${kw}`
const j1 = await tryJson('poiInfo 搜索 ' + LINE_NO + '路', searchUrl)
let busId = null
if (j1) {
  const list = (j1.data && j1.data.poi_list) || j1.poi_list || []
  console.log('poi_list 数量:', list.length)
  if (list[0]) {
    console.log('poi[0] keys:', keysOf(list[0]))
    console.log('poi[0] name/id/adcode:', list[0].name, list[0].id, list[0].adcode)
    const bl = list[0].buslines
    console.log('buslines 是否数组:', Array.isArray(bl), '长度:', Array.isArray(bl) ? bl.length : '-')
    if (Array.isArray(bl) && bl[0]) {
      console.log('buslines[0] keys:', keysOf(bl[0]))
      for (const k of Object.keys(bl[0])) {
        const v = bl[0][k]
        if (typeof v === 'string' && v.length > 60) console.log(`  ${k}: <len ${v.length}> ${v.slice(0, 120)}`)
        else console.log(`  ${k}:`, v)
      }
      busId = bl[0].id || bl[0].busId || null
    }
  }
}
console.log('\n解析出的 busId:', busId)

// 2) SSR 线路详情页
const ssrUrl =
  `https://www.amap.com/ssr/search/busline_detail?query_type=TQUERY&query=${kw}&city=420100` +
  `&geoobj=114.183559%7C30.498013%7C114.523448%7C30.679478&zoom=12&busId=${busId || '900000128833'}` +
  `&keywords=${kw}&key_name=${kw}`
await tryJson('SSR busline_detail', ssrUrl)

// 3) 其它可能的详情接口
for (const u of [
  `https://www.amap.com/detail/get/detail?id=${busId || '900000128833'}`,
  `https://www.amap.com/service/poiInfo?id=${busId || '900000128833'}`,
]) {
  await tryJson('detail ' + u, u)
}
