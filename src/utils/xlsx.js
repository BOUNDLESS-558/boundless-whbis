/**
 * 零依赖的最小 XLSX 生成器（真正的 .xlsx / OOXML）
 *
 * 只输出内联字符串单元格，不引第三方库；足以承载数据面板的表格导出。
 * 生成流程：组装若干 XML 部件 → ZIP(STORE, 无压缩) → Blob 下载。
 */
function utf8(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str)
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i)
      c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return new Uint8Array(out)
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = f.data
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, 0x0800, true)
    dv.setUint16(8, 0, true)
    dv.setUint16(10, 0, true)
    dv.setUint16(12, 0, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, data.length, true)
    dv.setUint32(22, data.length, true)
    dv.setUint16(26, name.length, true)
    dv.setUint16(28, 0, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    parts.push(local)

    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    cd.set(name, 46)
    central.push(cd)
    offset += local.length
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)

  const all = [...parts, ...central, end]
  const total = all.reduce((s, b) => s + b.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const b of all) { out.set(b, at); at += b.length }
  return out
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function colName(n) {
  let s = ''
  let i = n + 1
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

function sheetXml({ title = '', columns = [], rows = [] }) {
  const lines = []
  let idx = 1
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  lines.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
  lines.push('<sheetData>')
  const cell = (col, value) => `<c r="${colName(col)}${idx}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`
  if (title) {
    lines.push(`<row r="${idx}">${cell(0, title)}</row>`)
    idx++
  }
  lines.push(`<row r="${idx}">${columns.map((c, j) => cell(j, c)).join('')}</row>`)
  idx++
  for (const r of rows) {
    lines.push(`<row r="${idx}">${columns.map((_c, j) => cell(j, r[j])).join('')}</row>`)
    idx++
  }
  lines.push('</sheetData></worksheet>')
  return lines.join('')
}

/**
 * 生成 xlsx 字节（App 端写文件用）
 * @param {{title?:string, columns:string[], rows:any[][]}} p
 */
export function buildXlsxBytes(p) {
  const { title = '', columns = [], rows = [] } = p || {}
  if (!columns.length || !rows.length) return null
  const files = [
    {
      name: '[Content_Types].xml',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'),
    },
    {
      name: '_rels/.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'),
    },
    {
      name: 'xl/workbook.xml',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="营运数据" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'),
    },
    {
      name: 'xl/styles.xml',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="1"><font><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>' +
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
        '</styleSheet>'),
    },
    { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml({ title, columns, rows })) },
  ]
  return zip(files)
}

/** 生成 xlsx Blob（H5 下载用） */
export function buildXlsx(p) {
  const bytes = buildXlsxBytes(p)
  return bytes ? new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }) : null
}

export default { buildXlsx, buildXlsxBytes }
