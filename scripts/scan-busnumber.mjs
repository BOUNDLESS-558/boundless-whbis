/**
 * 车辆完整自编号采集（buspedia.top 车队页 → bus-number-map.json）
 *
 * 背景：后端 /detailData 返回的 busId = MD5(orgBusId)，只能还原出纯数字自编号
 *   （如 22517）。用户希望显示 buspedia 上的完整编号形式（如 117B2142、
 *   125B2023~2025）——即「公司号 + 线路/批次 + B + 车号」。
 *   buspedia 的车队页（/comp/zek3io/fleet/<id>）列出了这些完整编号，但**需要登录**。
 *
 * 用法：
 *   BUSPEDIA_COOKIE='<浏览器 Cookie>' node scripts/scan-busnumber.mjs --dump   # 抓原始响应，先看数据结构
 *   BUSPEDIA_COOKIE='<浏览器 Cookie>' node scripts/scan-busnumber.mjs           # 抓并解析，落盘映射表
 *   BUSPEDIA_COOKIE='<浏览器 Cookie>' node scripts/scan-busnumber.mjs --fleet lvymug  # 指定车队页
 *
 * Cookie 获取：浏览器登录 buspedia.top → F12 Network → 任一 api.buspedia.top 请求 →
 *   Request Headers 里复制整条 Cookie 值。Cookie 会过期，过期后重取即可。
 *
 * 环境变量：
 *   BUSPEDIA_COOKIE   登录 Cookie（必需，否则 401）
 *   BP_TIMEOUT        单请求超时 ms（默认 20000）
 *   BP_RETRIES        重试次数（默认 3，对端 TLS 偶发断连）
 *
 * 注意：Node 默认 IPv6 优先会导致 api.buspedia.top 连接失败，脚本开头强制 IPv4 优先。
 */
import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

dns.setDefaultResultOrder('ipv4first')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../src/static/bus-number-map.json')
const DUMP = path.resolve(__dirname, '../scripts/.busnumber-raw.json')
const API = 'https://api.buspedia.top'
const COOKIE = process.env.BUSPEDIA_COOKIE || ''
const TIMEOUT = Number(process.env.BP_TIMEOUT || 20000)
const RETRIES = Number(process.env.BP_RETRIES || 3)
const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const has = (n) => argv.includes('--' + n)
const DUMP_MODE = has('dump')
const FLEETS = String(argOf('fleet', 'lvymug')).split(',').map((s) => s.trim()).filter(Boolean)

if (!COOKIE) {
  console.error('× 缺少 BUSPEDIA_COOKIE 环境变量。请先登录 buspedia.top 并从浏览器复制 Cookie。')
  console.error('  示例：$env:BUSPEDIA_COOKIE = "<你的Cookie>"; node scripts/scan-busnumber.mjs --dump')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 带重试的 GET；手动解压（Node fetch 对该站 gzip 响应解压有异常） */
async function apiGet(urlPath) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(API + urlPath, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130',
          Cookie: COOKIE,
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://buspedia.top/',
        },
      })
      if (res.status === 401) throw new Error('401 UNAUTHORIZED（Cookie 无效或已过期）')
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      const enc = res.headers.get('content-encoding') || ''
      let text
      if (enc === 'gzip') text = zlib.gunzipSync(buf).toString('utf8')
      else if (enc === 'br') text = zlib.brotliDecompressSync(buf).toString('utf8')
      else if (enc === 'deflate') text = zlib.inflateSync(buf).toString('utf8')
      else text = buf.toString('utf8')
      // 兜底：未按 encoding 声明但实际是 gzip（魔数 1f 8b）
      if (text.startsWith('\u001f\u008b')) text = zlib.gunzipSync(buf).toString('utf8')
      return JSON.parse(text)
    } catch (e) {
      console.log(`  第 ${attempt}/${RETRIES} 次失败：${e.message}`)
      if (attempt === RETRIES) throw e
      await sleep(1500 * attempt)
    }
  }
}

console.log(`buspedia 车队采集：${FLEETS.length} 个车队页${DUMP_MODE ? '（--dump 原始模式）' : ''}`)
const raw = {}
for (const fleet of FLEETS) {
  const urlPath = `/comp/fleet/zek3io/${fleet}`
  console.log(`\n正在拉取 ${urlPath} ...`)
  try {
    raw[fleet] = await apiGet(urlPath)
    console.log(`  ✓ ${fleet}：${JSON.stringify(raw[fleet]).length} 字节`)
  } catch (e) {
    console.log(`  × ${fleet} 失败：${e.message}`)
  }
}

if (DUMP_MODE) {
  fs.writeFileSync(DUMP, JSON.stringify(raw, null, 2) + '\n', 'utf8')
  console.log(`\n已 dump 原始响应到 ${path.relative(process.cwd(), DUMP)}`)
  console.log('请查看该文件确认数据结构，再实现解析逻辑。')
  process.exit(0)
}

// —— 解析：待数据结构确认后实现 ——
console.log('\n原始数据已获取，但解析逻辑待数据结构确认（先跑 --dump）。')
console.log('原始响应预览：' + JSON.stringify(raw).slice(0, 800))
