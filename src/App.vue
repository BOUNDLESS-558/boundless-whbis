<script>
import { warmUp } from './utils/api.js'
// #ifdef H5
import { assetUrl } from './utils/asset.js'
// #endif

export default {
  onLaunch: function () {
    // 启动时后台构建车辆编号字典（分片执行，不阻塞界面）
    warmUp()
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
  background: rgba(129, 140, 248, 0.45);
  color: #ffffff;
}
</style>
