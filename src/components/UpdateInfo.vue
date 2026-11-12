<template>
  <!-- 右下角悬浮按钮：单击弹出软件更新信息。与全局玻璃卡 / 主按钮同一套配色与质感 -->
  <view>
    <view class="upd-fab" :class="{ 'has-new': hasNew }" @click="open" title="更新信息">
      <text class="upd-fab-ico">📰</text>
      <text v-if="hasNew" class="upd-fab-dot">新</text>
    </view>

    <!-- 更新信息弹窗：复用 .act-mask / .act-card 的玻璃卡视觉（色值 / 描边 / 高光一致） -->
    <view class="upd-mask" v-if="show" @click.self="close">
      <view class="upd-card">
        <view class="upd-head">
          <text class="upd-title">更新信息</text>
          <text class="upd-ver">v{{ currentVersion }}</text>
          <view class="upd-close" @click="close" title="关闭">✕</view>
        </view>

        <scroll-view class="upd-body" scroll-y>
          <view class="upd-rel" v-for="(r, i) in releases" :key="i">
            <view class="upd-rel-head">
              <text class="upd-rel-ver">v{{ r.version }}</text>
              <text class="upd-rel-date">{{ r.date }}</text>
              <text v-if="i === 0" class="upd-rel-new">当前</text>
            </view>
            <view class="upd-items">
              <view class="upd-item" v-for="(it, j) in r.items" :key="j">
                <text class="upd-bullet">·</text>
                <text class="upd-text">{{ it }}</text>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="upd-foot">
          <view class="upd-ok" @click="close">知道了</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
// 版本号来自 config.js（与 manifest.json 的 versionName 同源维护）
import { APP_VERSION } from '../config.js'

// 上次看过的版本号：用于「新」角标。看过即写入，下次进来不再提示
const SEEN_KEY = 'whbis:update-seen'

export default {
  name: 'UpdateInfo',
  data() {
    return {
      currentVersion: APP_VERSION,
      show: false,
      hasNew: false,
      // 更新记录：新增版本请压在数组最前（i===0 标记为「当前」）。
      // 内容聚焦用户可感知的改动，避免罗列内部重构。
      releases: [
        {
          version: '1.1.0',
          date: '2026-11-12',
          items: [
            '走向绘制修正：全量扫描并修正 115 段吸附到错误走廊的异常走向（典型如 D477 / D483 / D168 偏离达数公里）；运行时新增同名错线校验，杜绝高德按线路名匹配到错误线路导致走向「完全偏离」。',
            '停运线路核查：依据武汉市交通运输局、武汉公交集团等官方公告交叉核实，标记 154 条已取消 / 停运线路（含 K509、509 / 522 / 524、266 并入 26 路等），并同步从线网底图剔除；搜索框与线路库已排除停运线。',
            '新增右下角「更新信息」入口，可随时查看版本号与更新记录。',
          ],
        },
        {
          version: '1.0.0',
          date: '2026-10',
          items: [
            '首个版本发布：武汉公交实时车辆查询、线路走向、线路库、收藏夹、全市公交实时分布等核心功能上线。',
          ],
        },
      ],
    }
  },
  mounted() {
    let seen = ''
    try { seen = uni.getStorageSync(SEEN_KEY) || '' } catch (e) {}
    this.hasNew = seen !== this.currentVersion
  },
  methods: {
    open() {
      this.show = true
      this.hasNew = false
      try { uni.setStorageSync(SEEN_KEY, this.currentVersion) } catch (e) {}
    },
    close() {
      this.show = false
    },
  },
}
</script>

<style scoped>
/* ── 右下角悬浮按钮：默认贴边隐藏（只露左侧半圆），悬停 / 有新更新时滑出 ── */
.upd-fab {
  position: fixed;
  right: 0;
  bottom: 28rpx;
  z-index: 130;
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  /* 与主按钮同款强调色渐变（靛蓝 → 青），保证全站视觉统一 */
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  box-shadow: 0 12rpx 30rpx rgba(79, 110, 247, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
  cursor: pointer;
  /* 贴边态：整体右移 55%，只露 45% 半圆；悬停或有新更新时滑出 */
  transform: translateX(55%);
  transition: transform 0.28s ease, filter 0.2s ease;
}
.upd-fab:hover,
.upd-fab.has-new {
  transform: translateX(0);
  filter: brightness(1.08);
}
.upd-fab:active {
  transform: translateX(0) scale(0.93);
}
/* 贴边时图标随之左移，保证半圆里能看到完整图标；滑出后回正 */
.upd-fab-ico {
  font-size: 44rpx;
  line-height: 1;
  transform: translateX(-28rpx);
  transition: transform 0.28s ease;
}
.upd-fab:hover .upd-fab-ico,
.upd-fab.has-new .upd-fab-ico {
  transform: translateX(0);
}
/* 「新」角标：看过（打开弹窗）即消失 */
.upd-fab-dot {
  position: absolute;
  top: -4rpx;
  right: -4rpx;
  min-width: 30rpx;
  height: 30rpx;
  padding: 0 6rpx;
  box-sizing: border-box;
  line-height: 30rpx;
  text-align: center;
  font-size: 18rpx;
  font-weight: 700;
  color: #fff;
  background: #f43f5e;
  border-radius: 999rpx;
  box-shadow: 0 2rpx 8rpx rgba(244, 63, 94, 0.6);
}

/* ── 弹窗遮罩：与 .act-mask 同套（半透明压暗 + 居中 + 淡入）── */
.upd-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 7, 16, 0.62);
  animation: upd-fade 0.18s ease;
}
/* ── 玻璃卡：与 .act-card 同款色值 / 描边 / 圆角 / 高光 ── */
.upd-card {
  width: 600rpx;
  max-width: calc(100vw - 80rpx);
  max-height: 74vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: rgba(11, 16, 32, 0.96);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 28rpx;
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.18);
  overflow: hidden;
  animation: upd-pop 0.2s ease;
}
.upd-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 36rpx 36rpx 24rpx;
}
.upd-title {
  font-size: 34rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
  color: #eef1ff;
}
.upd-ver {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--ac-text);
  background: rgba(var(--ac-rgb), 0.22);
  border: 2rpx solid rgba(var(--ac-rgb), 0.5);
  border-radius: 999rpx;
  padding: 2rpx 16rpx;
}
.upd-close {
  margin-left: auto;
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.66);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid transparent;
  cursor: pointer;
}
.upd-close:active {
  transform: scale(0.92);
}
/* 记录区：卡片内滚动，细窄滚动条与全局一致 */
.upd-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 50vh;
  padding: 4rpx 36rpx;
  box-sizing: border-box;
}
.upd-rel {
  padding: 20rpx 0;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.08);
}
.upd-rel:last-child {
  border-bottom: none;
}
.upd-rel-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-bottom: 14rpx;
}
.upd-rel-ver {
  font-size: 28rpx;
  font-weight: 700;
  color: #fff;
}
.upd-rel-date {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.5);
}
.upd-rel-new {
  margin-left: auto;
  font-size: 20rpx;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  border-radius: 999rpx;
  padding: 2rpx 14rpx;
}
.upd-items {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.upd-item {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
  font-size: 24rpx;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.78);
}
.upd-bullet {
  flex: 0 0 auto;
  color: var(--ac-hi);
  font-weight: 800;
  line-height: 1.5;
}
.upd-text {
  flex: 1;
  min-width: 0;
}
.upd-foot {
  flex-shrink: 0;
  padding: 22rpx 36rpx 32rpx;
  border-top: 2rpx solid rgba(255, 255, 255, 0.08);
}
.upd-ok {
  height: 76rpx;
  line-height: 76rpx;
  text-align: center;
  border-radius: 16rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
  /* 与主按钮 .act-btn.main 同款渐变 */
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  box-shadow: 0 10rpx 26rpx rgba(79, 110, 247, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
  cursor: pointer;
}
.upd-ok:active {
  transform: scale(0.96);
}

@keyframes upd-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes upd-pop {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}
</style>
