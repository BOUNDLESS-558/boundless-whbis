<script>
import { warmUp } from './utils/api.js'
import { applySkin, watchSystemSkin, applyAccent } from './utils/settings.js'
// #ifdef H5
import { assetUrl } from './utils/asset.js'
// #endif

export default {
  onLaunch: function () {
    // 启动时后台构建车辆编号字典（分片执行，不阻塞界面）
    warmUp()
    // 皮肤：按设置（黑 / 白 / 跟随系统）应用到 <html data-skin>，并监听系统深浅色切换
    applySkin()
    watchSystemSkin()
    // 主题色：把（可能自定义过的）强调色变量族挂到 <html>，全站按钮/页签/选中态跟随
    applyAccent()
    // #ifdef H5
    // 子路径部署（如 GitHub Pages /repo/）时，将基址感知的背景图写入 CSS 变量
    document.documentElement.style.setProperty('--app-bg-image', `url("${assetUrl('/static/background.jpg')}")`)
    // favicon 同样基址感知（manifest 生成的 link 带的是站点根绝对路径）
    const fav = document.querySelector('link[rel="icon"]')
    if (fav) fav.setAttribute('href', assetUrl('/static/logo.png'))
    // #endif
  },
  onShow: function () {},
  onHide: function () {},
}
</script>

<style>
/* 全局主题：现代极光渐变背景 + 精致字体 */

/* 主题色变量族默认值（= 历史靛蓝配色），挂在 :root（即 documentElement）。
   注意：必须放 :root 而非 page —— settings.applyAccent() 把用户选择写到 documentElement，
   若 page 也声明默认值，会作为更近的祖先遮蔽 <html> 上的改动，导致选色无反应。*/
:root {
  --ac: #6366f1;
  --ac-hi: #818cf8;
  --ac-deep: #4f46e5;
  --ac-text: #c7d2fe;
  --ac-2: #06b6d4;
  --ac-rgb: 99, 102, 241;
  --ac2-rgb: 6, 182, 212;
}
page {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC',
    'Source Han Sans CN', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', Roboto,
    Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  color: #eef1ff;
  background-color: #070b18;
  /* 背景图 + 深色遮罩（保证文字可读）+ 底部渐变兑底 */
  background-image:
    linear-gradient(rgba(7, 11, 24, 0.62), rgba(7, 11, 24, 0.72)),
    var(--app-bg-image, url('/static/background.jpg')),
    linear-gradient(160deg, #070b18 0%, #0b1130 46%, #080d1e 100%);
  background-size: cover, cover, auto;
  background-position: center, center, center;
  background-repeat: no-repeat, no-repeat, no-repeat;
  background-attachment: fixed;
  min-height: 100vh;
}

/* 文字选中效果 */
::selection {
  background: rgba(var(--ac-rgb), 0.45);
  color: #ffffff;
}

/* ── 白色皮肤（html[data-skin='light']）──
   根节点反色滤镜方案：深色 UI 一键反转成浅色，图片 / 地图瓦片 / 画布 / 视频再
   反转一次还原本色（两次反转互相抵消）。CSS 规范对「根元素上的 filter」有豁免——
   不会改变 position:fixed 后代的包含块，悬浮窗 / 遮罩 / toast 定位不受影响；
   反转+色相旋转近似保留各强调色的色相（靛蓝仍靛蓝、玫红仍玫红），只翻明暗。 */
html[data-skin='light'] {
  filter: invert(1) hue-rotate(180deg);
  background: #e8edf6;
}
html[data-skin='light'] img,
html[data-skin='light'] uni-image,
html[data-skin='light'] canvas,
html[data-skin='light'] video,
/* 高德地图容器整体还原（瓦片 / 标记 / 覆盖物都是它的后代） */
html[data-skin='light'] #amap,
html[data-skin='light'] #amap *,
html[data-skin='light'] .amap-container,
html[data-skin='light'] .amap-container * {
  filter: invert(1) hue-rotate(180deg);
}
</style>
