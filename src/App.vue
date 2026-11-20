<script>
import { warmUp } from './utils/api.js'
import { warmUpBusNumber } from './utils/busNumber.js'
import { applySkin, watchSystemSkin, applyAccent, applyFont } from './utils/settings.js'
// #ifdef H5
import { assetUrl } from './utils/asset.js'
// #endif

export default {
  onLaunch: function () {
    // 启动时后台构建车辆编号字典（分片执行，不阻塞界面）
    warmUp()
    // 后台预加载完整自编号映射表（含车型字母，走 HTTP 缓存）
    warmUpBusNumber()
    // 皮肤：按设置（黑 / 白 / 跟随系统）应用到 <html data-skin>，并监听系统深浅色切换
    applySkin()
    watchSystemSkin()
    // 主题色：把（可能自定义过的）强调色变量族挂到 <html>，全站按钮/页签/选中态跟随
    applyAccent()
    // 界面字体：按设置注入 webfont CSS 并写 --app-font（选过的字体启动即恢复）
    applyFont()
    // #ifdef H5
    // 子路径部署（如 GitHub Pages /repo/）时，将基址感知的背景图写入 CSS 变量
    document.documentElement.style.setProperty('--app-bg-image', `url("${assetUrl('/static/img/background.jpg')}")`)
    // favicon 同样基址感知（manifest 生成的 link 带的是站点根绝对路径）
    const fav = document.querySelector('link[rel="icon"]')
    if (fav) fav.setAttribute('href', assetUrl('/static/img/logo.png'))
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
  /* 字体随「账号与设置 → 界面字体」切换：--app-font 挂在 <html>（settings.applyFont），
     未设置时回退到历史系统栈，与逐字一致 */
  font-family: var(--app-font, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC',
    'Source Han Sans CN', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', Roboto,
    Helvetica, Arial, sans-serif);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  color: #eef1ff;
  background-color: #070b18;
  /* 背景图 + 深色遮罩（保证文字可读）+ 底部渐变兑底 */
  background-image:
    linear-gradient(rgba(7, 11, 24, 0.62), rgba(7, 11, 24, 0.72)),
    var(--app-bg-image, url('/static/img/background.jpg')),
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

/* ── 白色皮肤「柔和纸感」（html[data-skin='light']，2026-11-12 重设计）──
   全站 700+ 处色值是深色硬编码，逐处改写成语义变量成本与风险过高，故保留
   「根节点反色」骨架，但不再让结果停在「纯白 + 高饱和 + 强对比」：
     · brightness(.89) 压掉 #fff 级亮面，把面板 / 卡片 / 底图落到柔和浅灰
     · contrast(.90)   收敛白底深字的极端对比，仍高于 WCAG 4.5:1
     · saturate(.52)   强调色 / 方向色 / 地图色块降饱和，减少色彩刺激
   顺序固定：先 invert + hue-rotate 翻明暗并还原色相，再做整体柔化；调换会让色相偏移。
   CSS 规范对「根元素上的 filter」有豁免——不会改变 position:fixed 后代的包含块，
   悬浮窗 / 遮罩 / toast 定位不受影响。
   html 自身也在滤镜链内，故以下深色值反色后才是页面看到的柔和浅灰。 */
html[data-skin='light'] {
  filter: invert(1) hue-rotate(180deg) brightness(0.89) contrast(0.90) saturate(0.52);
  background: #1b2029;
}

/* 深色遮罩 + 背景照片在根节点反色后会变成「浅色遮罩 + 负片照片」，既刺眼又脏。
   浅色皮肤改用纯柔和渐变（同样写深色让反色后成浅灰），并去掉照片层。 */
html[data-skin='light'] page {
  background-color: #1b2029;
  background-image: linear-gradient(160deg, #1b2029 0%, #242b37 48%, #181d26 100%);
}

/* 自绘走向图底色 / 地图瓦片：原恒定压暗滤镜作用在「已二次反色的负片瓦片」上，
   经根节点再反色反而把底图翻得更亮（截图里刺眼白底的根源）。浅色皮肤下：
   · 去掉 .tile-layer 的压暗滤镜，避免「压暗→反色→更亮」的悖论
   · 蒙版改写浅色值，反色后还原为深色压暗层，让瓦片回到柔和灰
   · 瓦片未到位的兜底底色同样写深色，避免露出深色块 */
html[data-skin='light'] .schematic {
  background: #1b2029;
}
html[data-skin='light'] .tile-layer {
  filter: none;
  background: #20252d;
}
html[data-skin='light'] .tile-shade {
  background: rgba(236, 240, 244, 0.38);
}

/* 头像 / Logo / 画布 / 地图瓦片等二次反色还原本色（两次反转互相抵消） */
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

/* ── 统一滚动条：所有面板 / 列表共用一套细窄半透明风格（与深色玻璃面板协调）──
   rpx 在 ::-webkit-scrollbar 伪元素上不一定被编译，故用 px 直接定宽 */
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.26) transparent;
}
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.26);
  border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.42);
}
::-webkit-scrollbar-corner {
  background: transparent;
}
</style>
