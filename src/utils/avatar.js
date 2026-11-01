/**
 * 用户头像（纯本地 · localStorage · 按账号隔离）
 *
 * - 存储 key：whbis:avatar:<小写账号>（复用 normAccount 主键），value 为 base64 DataURL
 * - 格式支持 PNG / JPG / JPEG（含 WebP）；H5 用隐藏 <input type="file"> 选图，
 *   canvas 中心方裁切 + 等比压缩到边长 ≤ 256，控制体积（约几十 KB）
 * - 不落后端、不进 git；未设置时 UI 回退默认头像（首字母色块）
 * - 可反复更换：每次选择直接覆盖旧值；removeAvatar 即「恢复默认」
 */
import { normAccount } from './auth.js'

const AVATAR_SIDE = 256 // 压缩后边长（正方形）
const MAX_ORIGIN = 5 * 1024 * 1024 // 原图上限 5MB，超限直接拒绝（压缩解决不了起点太差的图）
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp'] // JPG 即 image/jpeg

const keyOf = (account) => 'whbis:avatar:' + normAccount(account)

/** 当前账号的自定义头像 DataURL；未设置返回 '' */
export function getAvatar(account) {
  try {
    const v = uni.getStorageSync(keyOf(account))
    return typeof v === 'string' && v.startsWith('data:image') ? v : ''
  } catch (e) {
    return ''
  }
}

export function setAvatar(account, dataUrl) {
  try {
    uni.setStorageSync(keyOf(account), dataUrl)
    return true
  } catch (e) {
    return false
  }
}

/** 恢复默认 = 清掉自定义头像 */
export function removeAvatar(account) {
  try {
    uni.removeStorageSync(keyOf(account))
  } catch (e) { /* 忽略 */ }
}

/**
 * 选图并保存（H5：文件选择器 + canvas 压缩）。
 * 成功 resolve DataURL；用户取消 / 格式不符 / 读取失败 resolve ''（提示由本函数内给出）。
 */
export function pickAvatar(account) {
  return new Promise((resolve) => {
    // #ifndef H5
    uni.showToast({ title: '头像更换目前支持网页端', icon: 'none' })
    resolve('')
    // #endif
    // #ifdef H5
    let input = null
    try {
      input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/png,image/jpeg,image/webp'
      input.style.display = 'none'
      document.body.appendChild(input)
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0]
        input.remove()
        if (!file) return resolve('')
        if (!OK_TYPES.includes(file.type)) {
          uni.showToast({ title: '仅支持 PNG / JPG / JPEG 图片', icon: 'none' })
          return resolve('')
        }
        if (file.size > MAX_ORIGIN) {
          uni.showToast({ title: '图片太大（超 5MB），请换一张', icon: 'none' })
          return resolve('')
        }
        try {
          const url = await compressToAvatar(file)
          setAvatar(account, url)
          resolve(url)
        } catch (e) {
          uni.showToast({ title: '图片读取失败，请换一张试试', icon: 'none' })
          resolve('')
        }
      })
      input.click()
    } catch (e) {
      if (input && input.remove) input.remove()
      uni.showToast({ title: '无法打开图片选择器', icon: 'none' })
      resolve('')
    }
    // #endif
  })
}

// 读取文件 → 中心方裁切 + 等比压缩 → DataURL（PNG 保透明，JPG/WebP 走 JPEG 0.85）
function compressToAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const w = img.naturalWidth
        const h = img.naturalHeight
        if (!w || !h) return reject(new Error('empty image'))
        // 中心方裁切：头像天然是正方形展示，取原图中心最大方区再缩到 AVATAR_SIDE
        const side = Math.min(w, h, AVATAR_SIDE)
        const sx = (w - Math.min(w, h)) / 2
        const sy = (h - Math.min(w, h)) / 2
        const canvas = document.createElement('canvas')
        canvas.width = side
        canvas.height = side
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, sx, sy, Math.min(w, h), Math.min(w, h), 0, 0, side, side)
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
        resolve(canvas.toDataURL(type, 0.85))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
