<script>
import { warmUp } from './utils/api.js'
import { warmUpBusNumber } from './utils/busNumber.js'
import { applySkin, watchSystemSkin, applyAccent, applyFont, applyUiMode } from './utils/settings.js'
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
    // 界面组件库：按设置写 <html data-ui-mode> 并按需加载 Bootstrap / Element Plus CSS
    applyUiMode()
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
::root {
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
:::selection {
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

/* ── 界面组件库：Bootstrap / Element Plus 模式下的全局覆盖 ──
   切换到 bootstrap / element 时，<html data-ui-mode="…"> 让以下选择器命中，
   把自定义组件的关键交互元素（面板 / 按钮 / 分段控制 / 输入框 / 分区标题 / 头像区）
   适配成对应库的视觉风格。原生模式（data-ui-mode="native"）不命中，保持现有设计。
   两种模式都遵循「浅色底 + 深色字」的库原生规范（Bootstrap card / Element card 都是白底深字），
   故整块面板底色翻转为白底，文字反色，不再沿用深色玻璃拟态。 */

/* ═══════════ Bootstrap 模式 ═══════════ */

/* 面板整体：Bootstrap modal / card 风格 —— 白底 + 圆角 + 深阴影 */
html[data-ui-mode='bootstrap'] .float-win,
html[data-ui-mode='bootstrap'] .float-win-head,
html[data-ui-mode='bootstrap'] .float-win-body,
html[data-ui-mode='bootstrap'] .acct,
html[data-ui-mode='bootstrap'] .acct-id,
html[data-ui-mode='bootstrap'] .acct-id-main,
html[data-ui-mode='bootstrap'] .acct-name-row,
html[data-ui-mode='bootstrap'] .acct-avatar-ops,
html[data-ui-mode='bootstrap'] .acct-fold-bar,
html[data-ui-mode='bootstrap'] .acct-sec-body,
html[data-ui-mode='bootstrap'] .acct-pwd-field,
html[data-ui-mode='bootstrap'] .acct-btns,
html[data-ui-mode='bootstrap'] .acct-tip {
  background: #ffffff;
  color: #212529;
  border-color: #dee2e6;
}
html[data-ui-mode='bootstrap'] .float-win {
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.35);
  border: 1px solid #dee2e6;
  overflow: hidden;
}
html[data-ui-mode='bootstrap'] .float-win-head {
  background: #f8f9fa;
  border-bottom: 1px solid #dee2e6;
  padding: 12px 16px;
}
html[data-ui-mode='bootstrap'] .float-win-title {
  color: #212529;
  font-size: 18px;
  font-weight: 600;
}
html[data-ui-mode='bootstrap'] .float-win-sub {
  color: #6c757d;
  font-size: 12px;
}

/* 头像区 */
html[data-ui-mode='bootstrap'] .acct-avatar {
  background: #e9ecef;
  border: 2px solid #adb5bd;
}
html[data-ui-mode='bootstrap'] .acct-avatar-txt {
  color: #495057;
  font-size: 28px;
}
html[data-ui-mode='bootstrap'] .acct-avatar-cam {
  background: #6c757d;
  color: #fff;
}
html[data-ui-mode='bootstrap'] .acct-id-sub {
  color: #6c757d;
  font-size: 12px;
}
html[data-ui-mode='bootstrap'] .acct-name-save {
  background: var(--ac, #6366f1);
  color: #fff;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
html[data-ui-mode='bootstrap'] .acct-name-save:hover {
  background: var(--ac-deep, #4f46e5);
}

/* 按钮：Bootstrap .btn 规范 */
html[data-ui-mode='bootstrap'] .acct-btn,
html[data-ui-mode='bootstrap'] .acct-mini,
html[data-ui-mode='bootstrap'] .acct-fold-btn,
html[data-ui-mode='bootstrap'] .amap-btn,
html[data-ui-mode='bootstrap'] .act-btn {
  border: 1px solid #adb5bd;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #212529;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
html[data-ui-mode='bootstrap'] .acct-btn:hover,
html[data-ui-mode='bootstrap'] .acct-mini:hover,
html[data-ui-mode='bootstrap'] .acct-fold-btn:hover,
html[data-ui-mode='bootstrap'] .amap-btn:hover {
  background: #e9ecef;
  border-color: #adb5bd;
}
html[data-ui-mode='bootstrap'] .acct-btn.save,
html[data-ui-mode='bootstrap'] .amap-btn.primary,
html[data-ui-mode='bootstrap'] .act-btn.main {
  background: var(--ac, #6366f1);
  border-color: var(--ac, #6366f1);
  color: #fff;
}
html[data-ui-mode='bootstrap'] .acct-btn.save:hover,
html[data-ui-mode='bootstrap'] .amap-btn.primary:hover,
html[data-ui-mode='bootstrap'] .act-btn.main:hover {
  background: var(--ac-deep, #4f46e5);
  border-color: var(--ac-deep, #4f46e5);
}
html[data-ui-mode='bootstrap'] .acct-btn.ghost,
html[data-ui-mode='bootstrap'] .act-btn.ghost {
  background: #fff;
  border-color: #adb5bd;
  color: #212529;
}
html[data-ui-mode='bootstrap'] .acct-btn.ghost:hover,
html[data-ui-mode='bootstrap'] .act-btn.ghost:hover {
  background: #e9ecef;
}
html[data-ui-mode='bootstrap'] .acct-btn:active,
html[data-ui-mode='bootstrap'] .acct-mini:active {
  transform: translateY(1px);
}

/* 分段控制：Bootstrap .btn-group 规范 */
html[data-ui-mode='bootstrap'] .acct-seg {
  background: #e9ecef;
  border-radius: 8px;
  padding: 3px;
  display: inline-flex;
  gap: 2px;
  border: 1px solid #dee2e6;
}
html[data-ui-mode='bootstrap'] .acct-seg-item {
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 8px 18px;
  font-size: 14px;
  font-weight: 500;
  color: #495057;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  white-space: nowrap;
}
html[data-ui-mode='bootstrap'] .acct-seg-item:hover {
  background: #fff;
  color: #212529;
}
html[data-ui-mode='bootstrap'] .acct-seg-item.on {
  background: var(--ac, #6366f1);
  border-color: var(--ac, #6366f1);
  color: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}

/* 输入框：Bootstrap .form-control 规范 */
html[data-ui-mode='bootstrap'] .acct-name-input,
html[data-ui-mode='bootstrap'] .acct-pwd-input,
html[data-ui-mode='bootstrap'] .amap-input,
html[data-ui-mode='bootstrap'] .act-input {
  border: 1px solid #ced4da;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 14px;
  color: #212529;
  background: #fff;
  width: 100%;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
html[data-ui-mode='bootstrap'] .acct-name-input::placeholder,
html[data-ui-mode='bootstrap'] .acct-pwd-input::placeholder {
  color: #adb5bd;
}
html[data-ui-mode='bootstrap'] .acct-name-input:focus,
html[data-ui-mode='bootstrap'] .acct-pwd-input:focus,
html[data-ui-mode='bootstrap'] .amap-input:focus,
html[data-ui-mode='bootstrap'] .act-input:focus {
  outline: none;
  border-color: var(--ac, #6366f1);
  box-shadow: 0 0 0 0.2rem rgba(var(--ac-rgb, 99,102,241), 0.25);
}

/* 分区标题：Bootstrap .list-group-item 规范 */
html[data-ui-mode='bootstrap'] .acct-sec-head {
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: all 0.15s ease;
}
html[data-ui-mode='bootstrap'] .acct-sec-head:hover {
  background: #f8f9fa;
}
html[data-ui-mode='bootstrap'] .acct-sec-title {
  font-size: 15px;
  font-weight: 600;
  color: #212529;
}
html[data-ui-mode='bootstrap'] .acct-sec-sum {
  font-size: 13px;
  color: #6c757d;
}
html[data-ui-mode='bootstrap'] .acct-sec-chev {
  color: #6c757d;
  font-size: 12px;
  transition: transform 0.2s ease;
}
html[data-ui-mode='bootstrap'] .acct-sec-chev.folded {
  transform: rotate(-90deg);
}
html[data-ui-mode='bootstrap'] .acct-sec-body {
  border: 1px solid #dee2e6;
  border-top: none;
  border-radius: 0 0 8px 8px;
  padding: 16px;
  background: #fff;
}
html[data-ui-mode='bootstrap'] .acct-div {
  height: 1px;
  background: #dee2e6;
  margin: 12px 0;
  border: none;
}

/* 标签 / 值 / 提示文字 */
html[data-ui-mode='bootstrap'] .acct-label {
  color: #495057;
  font-size: 13px;
  font-weight: 500;
}
html[data-ui-mode='bootstrap'] .acct-value {
  font-size: 13px;
  color: #212529;
}
html[data-ui-mode='bootstrap'] .acct-value.ok {
  color: var(--ac, #6366f1);
  font-weight: 600;
}
html[data-ui-mode='bootstrap'] .acct-tip {
  font-size: 12px;
  color: #6c757d;
  line-height: 1.6;
}
html[data-ui-mode='bootstrap'] .acct-mini-hint {
  font-size: 11px;
  color: #adb5bd;
}
html[data-ui-mode='bootstrap'] .acct-fold-hint {
  font-size: 12px;
  color: #6c757d;
}
html[data-ui-mode='bootstrap'] .acct-name-ph {
  color: #adb5bd;
}

/* 密码字段 / 眼睛按钮 */
html[data-ui-mode='bootstrap'] .acct-pwd-field {
  position: relative;
  display: flex;
  align-items: center;
}
html[data-ui-mode='bootstrap'] .acct-eye {
  position: absolute;
  right: 12px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #adb5bd;
  font-size: 14px;
}
html[data-ui-mode='bootstrap'] .acct-eye.on {
  color: var(--ac, #6366f1);
}

/* 滚动条：Bootstrap 风格 */
html[data-ui-mode='bootstrap'] ::-webkit-scrollbar-thumb {
  background: #adb5bd;
  border-radius: 999px;
}
html[data-ui-mode='bootstrap'] ::-webkit-scrollbar-thumb:hover {
  background: #6c757d;
}
html[data-ui-mode='bootstrap'] ::-webkit-scrollbar-track {
  background: #f1f3f5;
}

/* ═══════════ Element Plus 模式 ═══════════ */

/* 面板整体：Element card 风格 */
html[data-ui-mode='element'] .float-win,
html[data-ui-mode='element'] .float-win-head,
html[data-ui-mode='element'] .float-win-body,
html[data-ui-mode='element'] .acct,
html[data-ui-mode='element'] .acct-id,
html[data-ui-mode='element'] .acct-id-main,
html[data-ui-mode='element'] .acct-name-row,
html[data-ui-mode='element'] .acct-avatar-ops,
html[data-ui-mode='element'] .acct-fold-bar,
html[data-ui-mode='element'] .acct-sec-body,
html[data-ui-mode='element'] .acct-pwd-field,
html[data-ui-mode='element'] .acct-btns,
html[data-ui-mode='element'] .acct-tip {
  background: #ffffff;
  color: #303133;
  border-color: #e6e6e6;
}
html[data-ui-mode='element'] .float-win {
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.2);
  border: 1px solid #e6e6e6;
  overflow: hidden;
}
html[data-ui-mode='element'] .float-win-head {
  background: #f5f7fa;
  border-bottom: 1px solid #e6e6e6;
  padding: 12px 16px;
}
html[data-ui-mode='element'] .float-win-title {
  color: #303133;
  font-size: 18px;
  font-weight: 600;
}
html[data-ui-mode='element'] .float-win-sub {
  color: #909399;
  font-size: 12px;
}

/* 头像区 */
html[data-ui-mode='element'] .acct-avatar {
  background: #f0f2f5;
  border: 2px solid #dcdfe6;
}
html[data-ui-mode='element'] .acct-avatar-txt {
  color: #606266;
  font-size: 28px;
}
html[data-ui-mode='element'] .acct-avatar-cam {
  background: #909399;
  color: #fff;
}
html[data-ui-mode='element'] .acct-id-sub {
  color: #909399;
  font-size: 12px;
}
html[data-ui-mode='element'] .acct-name-save {
  background: var(--ac, #6366f1);
  color: #fff;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
}
html[data-ui-mode='element'] .acct-name-save:hover {
  background: var(--ac-deep, #4f46e5);
  box-shadow: 0 2px 8px rgba(var(--ac-rgb, 99,102,241), 0.3);
}

/* 按钮：Element .el-button 规范 */
html[data-ui-mode='element'] .acct-btn,
html[data-ui-mode='element'] .acct-mini,
html[data-ui-mode='element'] .acct-fold-btn,
html[data-ui-mode='element'] .amap-btn,
html[data-ui-mode='element'] .act-btn {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #606266;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
html[data-ui-mode='element'] .acct-btn:hover,
html[data-ui-mode='element'] .acct-mini:hover,
html[data-ui-mode='element'] .acct-fold-btn:hover,
html[data-ui-mode='element'] .amap-btn:hover {
  background: #f5f7fa;
  border-color: #dcdfe6;
}
html[data-ui-mode='element'] .acct-btn.save,
html[data-ui-mode='element'] .amap-btn.primary,
html[data-ui-mode='element'] .act-btn.main {
  background: var(--ac, #6366f1);
  border-color: var(--ac, #6366f1);
  color: #fff;
}
html[data-ui-mode='element'] .acct-btn.save:hover,
html[data-ui-mode='element'] .amap-btn.primary:hover,
html[data-ui-mode='element'] .act-btn.main:hover {
  background: var(--ac-deep, #4f46e5);
  border-color: var(--ac-deep, #4f46e5);
  box-shadow: 0 2px 8px rgba(var(--ac-rgb, 99,102,241), 0.3);
}
html[data-ui-mode='element'] .acct-btn.ghost,
html[data-ui-mode='element'] .act-btn.ghost {
  background: #fff;
  border-color: #dcdfe6;
  color: #606266;
}
html[data-ui-mode='element'] .acct-btn.ghost:hover,
html[data-ui-mode='element'] .act-btn.ghost:hover {
  background: #f5f7fa;
}
html[data-ui-mode='element'] .acct-btn:active,
html[data-ui-mode='element'] .acct-mini:active {
  transform: translateY(1px);
}

/* 分段控制：Element 风格 */
html[data-ui-mode='element'] .acct-seg {
  background: #f0f2f5;
  border-radius: 4px;
  padding: 2px;
  display: inline-flex;
  gap: 2px;
  border: 1px solid #e6e6e6;
}
html[data-ui-mode='element'] .acct-seg-item {
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 8px 18px;
  font-size: 14px;
  font-weight: 500;
  color: #606266;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  white-space: nowrap;
}
html[data-ui-mode='element'] .acct-seg-item:hover {
  background: #fff;
  color: #303133;
}
html[data-ui-mode='element'] .acct-seg-item.on {
  background: var(--ac, #6366f1);
  border-color: var(--ac, #6366f1);
  color: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}

/* 输入框：Element .el-input 规范 */
html[data-ui-mode='element'] .acct-name-input,
html[data-ui-mode='element'] .acct-pwd-input,
html[data-ui-mode='element'] .amap-input,
html[data-ui-mode='element'] .act-input {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 10px 14px;
  font-size: 14px;
  color: #303133;
  background: #fff;
  width: 100%;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
html[data-ui-mode='element'] .acct-name-input::placeholder,
html[data-ui-mode='element'] .acct-pwd-input::placeholder {
  color: #c0c4cc;
}
html[data-ui-mode='element'] .acct-name-input:focus,
html[data-ui-mode='element'] .acct-pwd-input:focus,
html[data-ui-mode='element'] .amap-input:focus,
html[data-ui-mode='element'] .act-input:focus {
  outline: none;
  border-color: var(--ac, #6366f1);
  box-shadow: 0 0 0 2px rgba(var(--ac-rgb, 99,102,241), 0.2);
}

/* 分区标题：Element 风格 */
html[data-ui-mode='element'] .acct-sec-head {
  background: #fff;
  border: 1px solid #e6e6e6;
  border-radius: 4px;
  padding: 12px 16px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: all 0.15s ease;
}
html[data-ui-mode='element'] .acct-sec-head:hover {
  background: #f5f7fa;
}
html[data-ui-mode='element'] .acct-sec-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
html[data-ui-mode='element'] .acct-sec-sum {
  font-size: 13px;
  color: #909399;
}
html[data-ui-mode='element'] .acct-sec-chev {
  color: #909399;
  font-size: 12px;
  transition: transform 0.2s ease;
}
html[data-ui-mode='element'] .acct-sec-chev.folded {
  transform: rotate(-90deg);
}
html[data-ui-mode='element'] .acct-sec-body {
  border: 1px solid #e6e6e6;
  border-top: none;
  border-radius: 0 0 4px 4px;
  padding: 16px;
  background: #fff;
}
html[data-ui-mode='element'] .acct-div {
  height: 1px;
  background: #e6e6e6;
  margin: 12px 0;
  border: none;
}

/* 标签 / 值 / 提示文字 */
html[data-ui-mode='element'] .acct-label {
  color: #606266;
  font-size: 13px;
  font-weight: 500;
}
html[data-ui-mode='element'] .acct-value {
  font-size: 13px;
  color: #303133;
}
html[data-ui-mode='element'] .acct-value.ok {
  color: var(--ac, #6366f1);
  font-weight: 600;
}
html[data-ui-mode='element'] .acct-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
html[data-ui-mode='element'] .acct-mini-hint {
  font-size: 11px;
  color: #c0c4cc;
}
html[data-ui-mode='element'] .acct-fold-hint {
  font-size: 12px;
  color: #909399;
}
html[data-ui-mode='element'] .acct-name-ph {
  color: #c0c4cc;
}

/* 密码字段 / 眼睛按钮 */
html[data-ui-mode='element'] .acct-pwd-field {
  position: relative;
  display: flex;
  align-items: center;
}
html[data-ui-mode='element'] .acct-eye {
  position: absolute;
  right: 12px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #c0c4cc;
  font-size: 14px;
}
html[data-ui-mode='element'] .acct-eye.on {
  color: var(--ac, #6366f1);
}

/* 滚动条：Element 风格 */
html[data-ui-mode='element'] ::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 999px;
}
html[data-ui-mode='element'] ::-webkit-scrollbar-thumb:hover {
  background: #909399;
}
html[data-ui-mode='element'] ::-webkit-scrollbar-track {
  background: #f0f2f5;
}
</style>