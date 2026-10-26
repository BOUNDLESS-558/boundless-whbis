/**
 * 探针：OSM（Overpass）在武汉有没有公交数据 / 路网密度
 * 目的：判断「OSM 官方公交关系」能否替代 OSRM 作为精确走向来源
 * 用法：node scripts/probe-overpass.mjs
 */
const UA = 'boundless-whbis/1.0 (bus route geometry probe; local dev only)'

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

// 武汉外环线附近 bbox：公交站、公交 relation、路网条数
const QUERY = `[out:json][timeout:60];
(
  relation["type"="route"]["route"="bus"](30.3,114.0,30.9,114.7);
  node["highway"="bus_stop"](30.3,114.0,30.9,114.7);
  node["public_transport"="platform"](30.3,114.0,30.9,114.7);
  way["highway"](30.55,114.25,30.57,114.27);
);
out count;`

// 337 路是否被映射成 relation
const QUERY_LINE = `[out:json][timeout:60];
relation["type"="route"]["route"="bus"]["ref"~"337"](30.3,114.0,30.9,114.7);
out tags;`

async function run(base, data) {
  try {
    const r = await fetch(base, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '*/*',
      },
      body: 'data=' + encodeURIComponent(data),
    })
    const txt = await r.text()
    console.log(`--- ${base}  status ${r.status}  len ${txt.length}`)
    if (r.status !== 200) {
      console.log('  片段:', txt.slice(0, 180).replace(/\s+/g, ' '), '\n')
      return null
    }
    return JSON.parse(txt)
  } catch (e) {
    console.log(`--- ${base}  失败: ${e.message} \n`)
    return null
  }
}

for (const ep of ENDPOINTS) {
  const j = await run(ep, QUERY)
  if (!j) continue
  const els = j.elements || []
  console.log('  计数：')
  els.forEach((e) => console.log(`   ${e.type} 类型统计:`, JSON.stringify(e.tags || {})))
  const j2 = await run(ep, QUERY_LINE)
  if (j2) {
    console.log('  ref 含 337 的公交 relation 数:', (j2.elements || []).length)
    ;(j2.elements || []).slice(0, 6).forEach((e) => {
      const t = e.tags || {}
      console.log(`   id=${e.id} ref=${t.ref} name=${t.name} network=${t.network || '-'}`)
    })
  }
  break
}
