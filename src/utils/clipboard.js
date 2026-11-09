/**
 * 统一复制出口（全站所有「复制」按钮都走这里）
 *
 * 设置项 copyMode 决定行为：
 *   - 'text'  ：uni.setClipboardData 写 TSV / 纯文本（原有行为）
 *   - 'image' ：H5 用离屏 canvas 把同一份表格画成 PNG，经 ClipboardItem 写入系统剪贴板
 *               （粘贴到微信 / 文档 / 聊天窗口即为一张图片）；页脚标注生成时间，便于判断数据时效
 *   - 'excel' ：H5 把同一份表格写成带样式的 HTML <table>，以 text/html + text/plain 写入剪贴板，
 *               粘贴到 Excel / WPS 直接是可编辑表格（不是需要分列的文本）；不支持的环境降级为文本
 *
 * 为什么图片模式自己画 canvas 而不引第三方库：项目无 html2canvas/dom-to-image，
 * 且复制内容是结构化表格而非 DOM 截图，直接绘制更轻、更清晰、可控分页。
 * 三种模式共用同一份 { title, columns, rows }，保证内容一致，只是载体不同。
 */
import { getCopyMode } from './settings.js'

/** 由 {title, columns, rows} 拼出 TSV（三种模式共用同一份数据，保证内容一致） */
export function tableToText({ title = '', columns = [], rows = [] }) {
  const head = columns.length ? columns.join('\t') : ''
  return [title, head, ...rows.map((r) => r.join('\t'))].filter((x) => x !== '').join('\n')
}

/** 当前本地时间 → 'YYYY-MM-DD HH:mm:ss'（图片页脚标注，用来判断这份实时数据的截取时刻） */
function stampText(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
    `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
}

/** HTML 转义：站点名 / 公司名 / 备注里可能带 & < > " '，不转义会破坏 <table> 结构 */
function escHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 估算显示宽度：中文/全角按 1 个字宽，ASCII 按 0.55 个字宽 */
function textWidth(s, fontSize) {
  let n = 0
  for (const ch of String(s == null ? '' : s)) n += /[\u2e80-\uffef]/.test(ch) ? 1 : 0.55
  return n * fontSize
}

/**
 * 把表格画成 PNG Blob（仅 H5，同步返回）。
 * 必须同步：navigator.clipboard.write 要求在「用户手势」调用栈内发起，
 * 若先用 canvas.toBlob 的异步回调再写，浏览器会判定手势已失效而拒绝。
 * 画布按内容自适应；行数很多时按 MAX_H 截断并标注，避免生成超大图把剪贴板拖垮。
 */
function renderTablePng({ title, columns, rows }) {
  const FONT = 14
  const PAD = 18
  const LINE_H = 26
  const HEAD_H = 30
  const TITLE_H = title ? 38 : 0
  // 页脚：实时车辆 / 发车时刻都有时效性，图片必须自带截取时刻，转发后才知道是哪一刻的数据
  const FOOT_H = 26
  const STAMP = '生成时间：' + stampText()
  const MAX_H = 6000
  const colWidths = (columns.length ? columns : ['']).map((c, i) => {
    let w = textWidth(c, FONT) + 20
    for (const r of rows) w = Math.max(w, textWidth(r[i], FONT) + 20)
    return Math.max(64, Math.min(560, w))
  })
  const capRows = Math.min(rows.length, Math.floor((MAX_H - TITLE_H - HEAD_H - FOOT_H - PAD * 2 - 30) / LINE_H))
  const truncated = rows.length > capRows
  const shown = rows.slice(0, capRows)
  const W = Math.min(2400, colWidths.reduce((a, b) => a + b, 0) + PAD * 2)
  const H = TITLE_H + HEAD_H + shown.length * LINE_H + (truncated ? 30 : 0) + FOOT_H + PAD * 2

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.font = `500 ${FONT}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textBaseline = 'middle'

  let y = PAD
  if (title) {
    ctx.fillStyle = '#111827'
    ctx.font = `600 ${FONT + 3}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(title, PAD, y + TITLE_H / 2)
    y += TITLE_H
    ctx.font = `500 ${FONT}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  }
  // 表头
  ctx.fillStyle = '#eef2f7'
  ctx.fillRect(PAD, y, W - PAD * 2, HEAD_H)
  let x = PAD
  columns.forEach((c, i) => {
    ctx.fillStyle = '#334155'
    ctx.fillText(String(c), x + 8, y + HEAD_H / 2, colWidths[i] - 16)
    x += colWidths[i]
  })
  y += HEAD_H
  // 数据行（斑马纹）
  shown.forEach((r, ri) => {
    if (ri % 2 === 1) { ctx.fillStyle = '#f8fafc'; ctx.fillRect(PAD, y, W - PAD * 2, LINE_H) }
    x = PAD
    columns.forEach((_c, i) => {
      ctx.fillStyle = '#111827'
      ctx.fillText(String(r[i] == null ? '' : r[i]), x + 8, y + LINE_H / 2, colWidths[i] - 16)
      x += colWidths[i]
    })
    ctx.strokeStyle = '#e5e7eb'
    ctx.beginPath(); ctx.moveTo(PAD, y + LINE_H); ctx.lineTo(W - PAD, y + LINE_H); ctx.stroke()
    y += LINE_H
  })
  if (truncated) {
    ctx.fillStyle = '#64748b'
    ctx.fillText(`共 ${rows.length} 行，图片仅显示前 ${capRows} 行；完整数据请切换「复制为文本 / Excel」`, PAD, y + 16)
    y += 30
  }
  // 页脚：细分隔线 + 生成时间（与表格内容连成一张图，转发后仍能判断数据时效）
  ctx.strokeStyle = '#e5e7eb'
  ctx.beginPath(); ctx.moveTo(PAD, y + 4); ctx.lineTo(W - PAD, y + 4); ctx.stroke()
  ctx.fillStyle = '#64748b'
  ctx.font = `400 ${FONT - 2}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(STAMP, PAD, y + FOOT_H / 2 + 7, W - PAD * 2)
  // dataURL → 二进制 → Blob，全程同步，保住调用栈里的用户手势
  const b64 = String(canvas.toDataURL('image/png')).split(',')[1] || ''
  if (!b64) return null
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
}

/**
 * 把表格写成 HTML <table> 字符串（text/html 剪贴板载荷）。
 * 粘贴到 Excel / WPS 时由浏览器生成的 CF_HTML 识别成一个带样式的可编辑表格，
 * 不需要「数据 → 分列」。单元格强制文本格式，避免经纬度、10:15 之类被转成数字/时间/科学计数法。
 * 结构化数据缺失（只有自定义 text 的旧调用）时返回空串，由调用方降级为纯文本。
 */
export function renderTableHtml({ title = '', columns = [], rows = [] }) {
  if (!columns.length || !rows.length) return ''
  const n = columns.length
  // '\\@' 输出 CSS 字面量 '\@'：Excel 的「文本」格式指令
  const TEXT_FMT = "mso-number-format:'\\@';"
  const cell = (tag, v, extra = '') =>
    `<${tag} style="border:1px solid #cbd5e1;padding:4px 8px;${TEXT_FMT}${extra}">${escHtml(v)}</${tag}>`
  const titleRow = title
    ? `<tr><th colspan="${n}" style="border:1px solid #cbd5e1;padding:8px;background:#ffffff;` +
      `color:#111827;font-size:15px;font-weight:700;text-align:left;${TEXT_FMT}">${escHtml(title)}</th></tr>`
    : ''
  const stampRow =
    `<tr><td colspan="${n}" style="border:1px solid #cbd5e1;padding:4px 8px;` +
    `background:#ffffff;color:#64748b;font-size:11px;${TEXT_FMT}">${escHtml('生成时间：' + stampText())}</td></tr>`
  const head = `<tr>${columns.map((c) => cell('th', c, 'background:#eef2f7;color:#334155;font-weight:600;text-align:center;white-space:nowrap;')).join('')}</tr>`
  const body = rows.map((r, i) =>
    `<tr>${columns.map((_c, j) => cell('td', r[j], i % 2 === 1 ? 'background:#f8fafc;' : '')).join('')}</tr>`
  ).join('')
  return `<html><head><meta charset="utf-8"></head><body>` +
    `<table style="border-collapse:collapse;font-family:'Microsoft YaHei',Arial,sans-serif;font-size:12px;">` +
    `${titleRow}${stampRow}${head}${body}</table></body></html>`
}

/** 平台是否支持把富格式（图片 / HTML 表格）写进剪贴板（H5 安全上下文 + ClipboardItem） */
function canWriteRich() {
  // #ifdef H5
  try {
    return typeof window !== 'undefined' && window.isSecureContext &&
      !!navigator.clipboard && typeof navigator.clipboard.write === 'function' &&
      typeof window.ClipboardItem === 'function'
  } catch (e) { return false }
  // #endif
  // #ifndef H5
  return false
  // #endif
}

function writeText(text, toast) {
  return new Promise((resolve) => {
    uni.setClipboardData({
      data: text,
      success: () => { uni.showToast({ title: toast || '已复制文本', icon: 'none' }); resolve(true) },
      fail: () => { uni.showToast({ title: '复制失败', icon: 'none' }); resolve(false) },
    })
  })
}

/**
 * 复制一份表格。所有复制按钮统一调用本函数，行为完全由设置里的 copyMode 决定。
 * @param {Object} p { title, columns:string[], rows:string[][], text?:string,
 *   toast?:string, imageToast?:string, excelToast?:string }
 *   text 可覆盖默认 TSV（供有自定义表头/分段的旧调用复用，也作富格式的 text/plain 兜底）；
 *   toast / imageToast / excelToast 分别为三档的成功提示。
 */
export async function copyTable(p) {
  const {
    title = '', columns = [], rows = [], text = '',
    toast = '', imageToast = '', excelToast = '',
  } = p || {}
  if (!rows.length && !text) {
    uni.showToast({ title: '暂无可复制内容', icon: 'none' })
    return false
  }
  const plain = text || tableToText({ title, columns, rows })
  const mode = getCopyMode()
  if (mode === 'text') return writeText(plain, toast)

  // 富格式（图片 / Excel）共用的环境校验：不满足一律降级为纯文本，不让复制按钮失效
  if (!canWriteRich()) {
    uni.showToast({ title: '当前环境不支持该格式，已复制文本', icon: 'none' })
    return writeText(plain, '')
  }

  // Excel 模式：text/html 给 Excel / WPS，text/plain 给其它目标（微信 / 记事本）兜底。
  // ClipboardItem 的多个类型必须同步构造，navigator.clipboard.write 才认这是用户手势内发起。
  if (mode === 'excel') {
    try {
      const html = renderTableHtml({ title, columns, rows })
      if (!html) throw new Error('no structured table')
      const item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      uni.showToast({ title: excelToast || '已复制为 Excel 表格', icon: 'none' })
      return true
    } catch (e) {
      uni.showToast({ title: 'Excel 复制失败，已复制文本', icon: 'none' })
      return writeText(plain, '')
    }
  }

  // 图片模式
  try {
    const blob = renderTablePng({ title, columns, rows }) // 同步，不能 await
    if (!blob) throw new Error('canvas unavailable')
    const item = new window.ClipboardItem({ 'image/png': blob })
    await navigator.clipboard.write([item])
    uni.showToast({ title: imageToast || '已复制为图片', icon: 'none' })
    return true
  } catch (e) {
    uni.showToast({ title: '图片复制失败，已复制文本', icon: 'none' })
    return writeText(plain, '')
  }
}

/** 纯文本复制（非表格场景） */
export function copyPlain(text, toast) {
  return writeText(text, toast)
}

export default { copyTable, copyPlain, tableToText, renderTableHtml }
