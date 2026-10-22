/**
 * 基址感知的静态资源路径解析
 *
 * 背景：H5 子路径部署（如 GitHub Pages 项目页 https://user.github.io/boundless-whbis/）时，
 * 代码里写死的 `/static/xxx` 会被解析成站点根 `https://user.github.io/static/xxx` → 404。
 * 这些引用（地图 marker iconPath、<image src>、CSS 背景）不参与 vite 构建期改写，
 * 需在运行时用 import.meta.env.BASE_URL（= manifest h5.router.base）手动拼前缀。
 *
 * - dev / 根域部署：BASE_URL 为 '/'，返回原路径，行为不变。
 * - 子路径部署：BASE_URL 为 '/boundless-whbis/'，拼成 '/boundless-whbis/static/xxx'。
 * - App / 小程序：BASE_URL 不适用，原生支持 '/static'，原样返回。
 */

// #ifdef H5
const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/'
// #endif

export function assetUrl(path) {
  if (!path) return path
  if (/^https?:\/\//.test(path) || path.indexOf('data:') === 0) return path
  // #ifdef H5
  return BASE.replace(/\/+$/, '') + path
  // #endif
  // #ifndef H5
  return path
  // #endif
}

export default assetUrl
