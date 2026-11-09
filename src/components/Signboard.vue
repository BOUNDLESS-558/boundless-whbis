<template>
  <!-- 仿真站牌：线路走向的站牌风格呈现（白底红块 + 站点竖排 + 连线 + 首末站高亮）。
       只做展示，不接管地图交互；数据由 LineMap 传入，不含任何逻辑。 -->
  <view class="sb-wrap">
    <view class="sb-card" v-for="g in groups" :key="g.dir">
      <!-- 左侧：线路号块（红底）+ 开往终点 + 首末班 -->
      <view class="sb-side">
        <view class="sb-no">{{ line.no || '—' }}</view>
        <view class="sb-to">
          <text class="sb-to-k">开往</text>
          <text class="sb-to-v">{{ g.to || line.end || '—' }}</text>
        </view>
        <view class="sb-time" v-if="line.early || line.last">{{ line.early || '--' }} - {{ line.last || '--' }}</view>
      </view>

      <!-- 右侧：站点横向序列（站名竖排、圆点连线、首末站红色加粗） -->
      <view class="sb-track">
        <view
          class="sb-stop"
          v-for="(s, i) in g.stops"
          :key="g.dir + '-' + i"
          :class="{ terminal: s.terminal }"
        >
          <text class="sb-name">{{ s.name }}</text>
          <view class="sb-dot"></view>
        </view>
      </view>

      <!-- 票价 -->
      <view class="sb-price" v-if="line.price">
        <text class="sb-price-k">票价</text>
        <text class="sb-price-v">{{ line.price }}</text>
      </view>
    </view>

    <view class="sb-empty" v-if="!groups.length">
      <text class="sb-empty-ico">🚏</text>
      <text class="sb-empty-txt">暂无站点走向数据</text>
    </view>
  </view>
</template>

<script>
export default {
  name: 'Signboard',
  props: {
    // 线路元数据：no / name / early / last / price / end
    line: { type: Object, default: () => ({}) },
    // 分组：{ dir, dirName, to, from, stops: [{ name, terminal }] }
    groups: { type: Array, default: () => [] },
  },
}
</script>

<style scoped>
.sb-wrap {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18rpx;
  padding: 32rpx 24rpx;
  box-sizing: border-box;
  background: #0b1020;
  overflow-y: auto;
  touch-action: pan-y;
}
/* 单张站牌卡：白底、圆角、投影，像实体站牌贴片 */
.sb-card {
  display: flex;
  align-items: stretch;
  min-height: 236rpx;
  background: #f7f7f2;
  border-radius: 10rpx;
  overflow: hidden;
  box-shadow: 0 10rpx 28rpx rgba(0, 0, 0, 0.45);
}
/* 左侧红色线路号块 */
.sb-side {
  flex: 0 0 auto;
  width: 176rpx;
  padding: 14rpx 10rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  background: #d81e24;
  color: #fff;
}
.sb-no {
  font-size: 68rpx;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 1rpx;
  font-variant-numeric: tabular-nums;
}
.sb-to {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rpx;
  text-align: center;
}
.sb-to-k {
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.82);
}
.sb-to-v {
  font-size: 20rpx;
  line-height: 1.2;
  color: #fff;
  font-weight: 700;
}
.sb-time {
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.86);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 站点序列：横向可滚，每站竖排站名 + 底部圆点，圆点间横向连线 */
.sb-track {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  padding: 18rpx 14rpx;
  overflow-x: auto;
  overflow-y: hidden;
  touch-action: pan-x;
}
.sb-stop {
  position: relative;
  flex: 0 0 auto;
  width: 46rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.sb-name {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-size: 22rpx;
  line-height: 1.12;
  letter-spacing: 1rpx;
  color: #1c1c1c;
  white-space: nowrap;
  overflow: hidden;
}
.sb-stop.terminal .sb-name {
  color: #d81e24;
  font-weight: 800;
}
/* 圆点固定在同一水平线：站名区占满上方，圆点行高固定 */
.sb-dot {
  flex: 0 0 auto;
  width: 10rpx;
  height: 10rpx;
  margin-top: 10rpx;
  border-radius: 50%;
  background: #d81e24;
  position: relative;
  z-index: 1;
}
.sb-stop.terminal .sb-dot {
  width: 14rpx;
  height: 14rpx;
  background: #d81e24;
  box-shadow: 0 0 0 3rpx rgba(216, 30, 36, 0.25);
}
/* 到下一站的连线：从圆点中心向右铺满一个站距，末站不画 */
.sb-stop:not(:last-child) .sb-dot::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46rpx;
  height: 3rpx;
  margin-top: -1.5rpx;
  background: #e6a3a5;
}
/* 右侧票价 */
.sb-price {
  flex: 0 0 auto;
  width: 96rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  background: #efece2;
  border-left: 2rpx solid #ddd6c6;
}
.sb-price-k {
  font-size: 18rpx;
  color: #6b6250;
}
.sb-price-v {
  font-size: 24rpx;
  font-weight: 800;
  color: #d81e24;
  font-variant-numeric: tabular-nums;
}
/* 空态 */
.sb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  color: rgba(255, 255, 255, 0.5);
}
.sb-empty-ico { font-size: 64rpx; opacity: 0.8; }
.sb-empty-txt { font-size: 26rpx; }
</style>
