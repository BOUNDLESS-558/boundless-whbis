/**
 * 诊断并改进 646路 OSRM 走向（v4 map-matching + 分段修复）
 *
 * 步骤：
 *   1. 读取 src/static/lines/jt/b35.json 中 646路的清洗后站点
 *   2. 运行 routeAlongRoads（v4 算法，含 map-matching）
 *   3. 输出每段直线距离 vs OSRM路径长度、绕路比
 *   4. 对比旧路由点数和总长
 */
import fs from 'node:fs'
import { gcj02ToWgs84, wgs84ToGcj02, haversine, maxExcursion } from './_geo.mjs'

const SHARD = 'src/static/lines/jt/b35.json'
const j = JSON.parse(fs.readFileSync(SHARD, 'utf8'))
const line646 = j.lines['646'] || {}
if (!line646.dirs?.['0']) { console.log('b35.json 无 646路数据'); process.exit(1) }

// ── OSRM helpers ──
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving'
const MATCH_BASE = 'https://router.project-osrm.org/match/v1/driving'
const TOUT = 12000
const MAX_WP = 18
const SIMPLIFY_TOL = 0.00006

async function callOsrm(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TOUT) })
    if (!r.ok) return null
    return await r.json()
  } catch(e) { return null }
}

async function requestMatchAll(wgs) {
  if (wgs.length < 2 || wgs.length > 100) return null
  const coordPath = wgs.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const url = `${MATCH_BASE}/${coordPath}?overview=full&geometries=geojson&radiuses=${wgs.map(()=>120).join(';')}`
  const j2 = await callOsrm(url)
  if (!j2 || j2.code !== 'Ok' || !j2.matchings?.length) return null
  const coords = j2.matchings[0].geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return null
  return coords.map(([lng,lat]) => ({lat, lng}))
}

async function requestSegment(waypoints) {
  const coordPath = waypoints.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const url = `${OSRM_BASE}/${coordPath}?overview=full&geometries=geojson&steps=true`
  const j2 = await callOsrm(url)
  if (!j2 || j2.code !== 'Ok' || !j2.routes?.length) return null
  const legs = j2.routes[0].legs || []
  return legs.map((leg, idx) => {
    const pts = []
    ;(leg.steps||[]).forEach(st => {
      ((st.geometry&&st.geometry.coordinates)||[]).forEach(([lng,lat]) => pts.push({lat,lng}))
    })
    // 若 steps 为空直接取 route geometry
    if(pts.length===0 && j2.routes[0].geometry?.coordinates){
      j2.routes[0].geometry.coordinates.forEach(([lng,lat])=>pts.push({lat,lng}))
    }
    return { pts, distance: leg.distance||0 }
  })
}

function simplify(pts, tol) {
  if(!pts||pts.length<=2) return pts
  const out=[pts[0]]; let last=pts[0]
  for(let i=1;i<pts.length;i++){
    if(haversine(last,pts[i])>tol*111000){out.push(pts[i]);last=pts[i]}
  }
  out.push(pts[pts.length-1])
  return out
}

function stripLoops(pts, minSeg=4000, closeDist=80, maxCuts=8) {
  if(!pts||pts.length<10) return {pts:pts||[],removed:0}
  const span = pts.reduce((s,p,i)=>i?s+haversine(pts[i-1],p):0,0)
  if(haversine(pts[0],pts[pts.length-1])<200 && span>minSeg) return {pts,removed:0}
  const out=[pts[0]]; let removed=0,cuts=0,i=0
  while(i<pts.length-1){
    let cut=-1, segLen=0
    for(let k=i+1;k<pts.length;k++){
      segLen+=haversine(pts[k-1],pts[k])
      if(segLen>minSeg && haversine(pts[i],pts[k])<closeDist){cut=k;break}
      if(segLen>60000) break
    }
    if(cut>i+1 && cut<pts.length-1 && cuts<maxCuts){removed+=cut-i-1;cuts++;i=cut;continue}
    out.push(pts[i+1]);i++
  }
  return {pts:out,removed}
}

function pointsOf(stops){return stops.map(s=>({lat:s.latitude,lng:s.longitude}))}

// ── 主路径计算（与 scan-routes.mjs 逻辑一致）──
async function routeAlongRoads(stops) {
  const gcjStops = pointsOf(stops)
  const wgs = gcjStops.map(p=>gcj02ToWgs84(p.lat,p.lng))

  // map-matching
  if(wgs.length>=2 && wgs.length<=100){
    const matched = await requestMatchAll(wgs)
    if(matched && matched.length>=2){
      const gcj = matched.map(p=>wgs84ToGcj02(p.lat,p.lng))
      const lats=gcjStops.map(p=>p.lat), lngs=gcjStops.map(p=>p.lng)
      const minLat=Math.min(...lats),maxLat=Math.max(...lats)
      const minLng=Math.min(...lngs),maxLng=Math.max(...lngs)
      const padLat=Math.max((maxLat-minLat)*0.25,0.003),padLng=Math.max((maxLng-minLng)*0.25,0.003)
      const sane = gcj.every(p=>p.lat>=minLat-padLat&&p.lat<=maxLat+padLat&&p.lng>=minLng-padLng&&p.lng<=maxLng+padLng)
      if(sane){
        const cleaned=stripLoops(gcj)
        return simplify(cleaned.pts,SIMPLIFY_TOL)
      }
    }
  }

  // fallback: per-segment with retry
  const acc=[]
  let legsTotal=0,legsBad=0,repaired=0
  const push=p=>{const l=acc[acc.length-1];if(!l||Math.abs(l.lat-p.lat)>1e-8||Math.abs(l.lng-p.lng)>1e-8)acc.push(p)}
  const judge=(a,b,leg,count=true)=>{
    const straight=haversine(a,b),allow=Math.max(straight*0.5,260)
    const good=leg&&leg.pts&&leg.pts.length>1&&leg.distance<=straight*2.2+350&&maxExcursion(leg.pts,a,b)<=allow
    if(count){legsTotal++;if(!good)legsBad++}
    return good
  }
  for(let i=0;i<wgs.length-1;i+=MAX_WP-1){
    const seg=wgs.slice(i,Math.min(i+MAX_WP,wgs.length))
    if(seg.length<2)break
    const legs=await requestSegment(seg)
    if(!legs) continue
    for(let k=0;k+1<seg.length;k++){
      const a=seg[k],b=seg[k+1],leg=legs[k]
      if(judge(a,b,leg)){leg.pts.forEach(push)}
      else{
        const m1={lat:a.lat+(b.lat-a.lat)/3,lng:a.lng+(b.lng-a.lng)/3}
        const m2={lat:a.lat+(b.lat-a.lat)*2/3,lng:a.lng+(b.lng-a.lng)*2/3}
        const sub=await requestSegment([a,m1,m2,b])
        let ok=false
        if(sub&&sub.length===3){
          const g1=judge(a,m1,{pts:sub[0],distance:haversine(a,m1)},false)
          const g2=judge(m1,m2,{pts:sub[1],distance:haversine(m1,m2)},false)
          const g3=judge(m2,b,{pts:sub[2],distance:haversine(m2,b)},false)
          if(g1&&g2&&g3){sub[0].pts.forEach(push);sub[1].pts.forEach(push);sub[2].pts.forEach(push);ok=true;repaired++}
        }
        if(!ok)[a,b].forEach(push)
      }
    }
    if(i+MAX_WP-1>=wgs.length-1)break
  }
  if(acc.length<2)return null
  if(legsTotal&&legsBad/legsTotal>0.5)return null
  const gcj=acc.map(p=>wgs84ToGcj02(p.lat,p.lng))
  if(!gcj.every(p=>true)){} // sanity
  const cleaned=stripLoops(gcj)
  return simplify(cleaned.pts,SIMPLIFY_TOL)
}

// ── 分析单方向 ──
async function analyze(dir) {
  const label = dir===0?'上行':'下行'
  const d = line646.dirs[String(dir)]
  const stops = d.stops.filter(s=>s.latitude&&s.longitude)
  if(stops.length<2){console.log(`646 ${label}: 站点不足(${stops.length})，跳过`);return}

  console.log(`\n========================================`)
  console.log(`646路 ${label}  —  ${stops.length} 站`)
  console.log(`当前 algo=${d.algo}  snapped=${d.snapped}  source=${d.source}  routePoints=${Math.floor(d.route.length/2)}`)

  // 旧路由
  const oldPts=[]
  for(let i=0;i<d.route.length;i+=2) oldPts.push({lat:d.route[i+1],lng:d.route[i]})
  const oldStraight = oldPts.length>1?haversine(oldPts[0],oldPts[oldPts.length-1]):0
  const oldPathLen = oldPts.reduce((s,p,i)=>i?s+haversine(oldPts[i-1],p):0,0)
  console.log(`旧路由: ${oldPts.length}点, 总长 ${(oldPathLen/1000).toFixed(2)}km`)

  // 新路由
  console.log('运行 v4 OSRM 路径规划（map-matching + 分段修复）…')
  const newRoute = await routeAlongRoads(stops)
  if(!newRoute){console.log('⚠ 新路由为空（服务不可用或全部回退弦）');return}
  const newPathLen = newRoute.reduce((s,p,i)=>i?s+haversine(newRoute[i-1],p):0,0)
  console.log(`新路由: ${newRoute.length}点, 总长 ${(newPathLen/1000).toFixed(2)}km`)

  // 逐段指标
  console.log('\n  站名                          | 起点→终点 距(m) | OSRM距(m) | 比率 | 状态')
  console.log('  '+'─'.repeat(72))
  let totalS=0,totalL=0,badCnt=0
  for(let i=0;i<stops.length-1;i++){
    const a={lat:stops[i].latitude,lng:stops[i].longitude}
    const b={lat:stops[i+1].latitude,lng:stops[i+1].longitude}
    const straight=haversine(a,b)
    totalS+=straight
    // 在 newRoute 中找近似该段的子序列
    // 简单方法：用新路由的累计距离反推各段
    // 更精确：对每站找新路由中最近的点作为端点
    const wa=gcj02ToWgs84(a.lat,a.lng), wb=gcj02ToWgs84(b.lat,b.lng)
    // 在新路由 WGS 点列中找最近点
    const nearest = (target)=>{
      let best=newRoute[0], bestD=Infinity
      for(const p of newRoute){
        const w=wgs84ToGcj02(p.lat,p.lng)
        const d2=haversine(target,w)
        if(d2<bestD){bestD=d2;best=p}
      }
      return best
    }
    // 简化：直接用直线距离报告（OSRM结果需要匹配到对应站点对）
  }
  // 更好的方式：用新路由点序列和站点逐一关联
  const staWGS = stops.map(s=>gcj02ToWgs84(s.latitude,s.longitude))
  const newWGS = newRoute.map(p=>({lat:p.lat,lng:p.lng})) // already GCJ from simplify output
  // 实际 newRoute 是 GCJ（routeAlongRoads 内部最后做 GCJ 转换），所以直接用
  const routeGCJ = newRoute

  // 找每个站在新路由中的最近点索引
  const idxAtStop = (stopGCJ) => {
    let bestIdx=0, bestD=Infinity
    for(let i=0;i<routeGCJ.length;i++){
      const d=haversine(stopGCJ, routeGCJ[i])
      if(d<bestD){bestD=d;bestIdx=i}
    }
    return bestIdx
  }
  const stopIdxes = stops.map(s=>idxAtStop({lat:s.latitude,lng:s.longitude}))

  for(let i=0;i<stops.length-1;i++){
    const a=stops[i], b=stops[i+1]
    const straight=haversine({lat:a.latitude,lng:a.longitude},{lat:b.latitude,lng:b.longitude})
    // 在新路由中找到对应的子序列起止索引
    const iA=stopIdxes[i], iB=stopIdxes[i+1]
    const segPts = routeGCJ.slice(Math.min(iA,iB), Math.max(iA,iB)+1)
    const segLen = segPts.reduce((s,p,k)=>k?s+haversine(segPts[k-1],p):0,0)
    const ratio = straight>0?(segLen/straight):999
    const status = ratio<=1.5?'✓':ratio<=3?'△':'✗'
    if(ratio>3) badCnt++
    totalL+=segLen
    const name = (a.stopName||'').padEnd(22)
    console.log(`  ${name}| ${straight.toFixed(0).padStart(6)} | ${segLen.toFixed(0).padStart(7)} | ${(ratio).toFixed(2)}  ${status}`)
  }
  console.log(`\n  合计: 直线 ${totalS.toFixed(0)}m, OSRM路径 ${totalL.toFixed(0)}m, 整体绕路比 ${(totalL/totalS).toFixed(2)}`)
  console.log(`  旧: 直线 ${oldStraight.toFixed(0)}m, 旧路径 ${oldPathLen.toFixed(0)}m, 旧绕路比 ${(oldPathLen/oldStraight).toFixed(2)}`)
}

console.log('══════════════════════════════════════')
console.log('646路 OSRM 走向诊断（v4 map-matching）')
console.log('══════════════════════════════════════')
await analyze(0)
await analyze(1)
console.log('\n完成。如需更新资产，运行:')
console.log('  node scripts/scan-routes.mjs --only 646 --force')
