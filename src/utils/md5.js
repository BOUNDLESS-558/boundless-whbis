/**
 * 纯 JavaScript MD5 实现（无第三方依赖）
 * 用于本地校验/还原公交 API 中加密的车辆编号（busId/busNo = MD5(orgBusId)）
 * 来源：RFC 1321 标准 MD5 算法
 */

/**
 * 计算字符串的 MD5 哈希值（返回 32 位小写十六进制）
 * @param {string} str 输入字符串
 * @returns {string} MD5 十六进制摘要
 */
export function md5(str) {
  // 将输入转为 UTF-8 字节数组
  const bytes = utf8ToBytes(str)
  return md5Bytes(bytes)
}

/**
 * 对字节数组计算 MD5
 * @param {number[]} bytes
 * @returns {string}
 */
function md5Bytes(bytes) {
  // 初始向量 (标准 A/B/C/D)
  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  const bitLen = bytes.length * 8

  // 填充消息：补 0x80，再补 0 至 512 位边界，末尾 64 位为原始长度
  const padded = bytes.slice()
  padded.push(0x80)
  while (padded.length % 64 !== 56) padded.push(0)

  // 追加 64 位长度（小端序）
  for (let i = 0; i < 8; i++) {
    padded.push(Math.floor(bitLen / Math.pow(2, 8 * i)) & 0xff)
  }

  // 每 512 位（64 字节）一块处理
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Array(16)
    for (let i = 0; i < 16; i++) {
      M[i] = padded[off + i * 4] | (padded[off + i * 4 + 1] << 8) | (padded[off + i * 4 + 2] << 16) | (padded[off + i * 4 + 3] << 24)
    }

    let A = a, B = b, C = c, D = d

    // 64 轮主循环
    for (let i = 0; i < 64; i++) {
      let F, g
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      const s = S[i]
      const tmp = D
      D = C
      C = B
      B = (B + rotl(A + F + K[i] + M[g], s)) | 0
      A = tmp
    }

    a = (a + A) | 0
    b = (b + B) | 0
    c = (c + C) | 0
    d = (d + D) | 0
  }

  // 输出为小端序十六进制
  return toHex(a) + toHex(b) + toHex(c) + toHex(d)
}

// 每轮循环左移位数
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]

// 正弦常数表
const K = (() => {
  const k = new Array(64)
  for (let i = 0; i < 64; i++) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) & 0xffffffff
  }
  return k
})()

/** 32 位整数循环左移 */
function rotl(x, c) {
  return (x << c) | (x >>> (32 - c))
}

/** 32 位整数转 8 位小端十六进制 */
function toHex(n) {
  let out = ''
  for (let i = 0; i < 4; i++) {
    const byte = (n >>> (i * 8)) & 0xff
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}

/** UTF-8 字符串转字节数组 */
function utf8ToBytes(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return bytes
}

/**
 * 还原加密车辆编号：遍历候选编号，MD5 比对。
 * 公交内部编号为纯数字字符串，采用二分式逐位枚举（优先常见区间）快速还原。
 * @param {string} hash busId/busNo 加密值（32 位小写十六进制）
 * @param {number} [max=40000] 枚举上限
 * @returns {string|null} 还原出的原始编号，未找到返回 null
 */
export function md5Reverse(hash, max = 40000) {
  hash = (hash || '').toLowerCase()
  // 优先常见内部编号区间（基于抓包数据：32379 / 3240 / 3228 / 32195 / 3306 等）
  const ranges = [[0, 100], [1000, 10000], [3000, 33000], [33000, max]]
  for (const [lo, hi] of ranges) {
    const start = Math.max(1, lo)
    const end = Math.min(hi, max)
    for (let n = start; n <= end; n++) {
      if (md5(String(n)) === hash) return String(n)
    }
  }
  return null
}