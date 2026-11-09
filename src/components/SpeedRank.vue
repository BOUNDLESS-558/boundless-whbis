<template>
  <!-- 车速榜浮窗：全市态右上角。不带遮罩，开窗时地图仍可拖拽缩放 -->
  <view class="rank-card" :class="{ folded: folded }">
    <!-- 标题整行可点折叠，折叠态本机记忆；关闭按钮单独 stop 避免误触 -->
    <view class="rank-head" :title="folded ? '展开车速榜' : '折叠车速榜'" @click="toggleFold">
      <view class="rank-title-wrap">
        <text class="rank-title">🏁 车速榜</text>
        <text class="rank-sub">{{ stampText }} · 全局 {{ total }} 辆</text>
      </view>
      <view class="rank-head-ops">
        <view class="rank-mini fold-btn" :class="{ folded: folded }" :title="folded ? '展开' : '折叠'" @click.stop="toggleFold">▾</view>
        <view class="rank-mini" title="关闭" @click.stop="$emit('close')">✕</view>
      </view>
    </view>

    <view v-show="!folded" class="rank-body">
      <!-- 档位：10 / 20 / 50 名自由切换 -->
      <view class="rank-limits">
        <view
          v-for="n in limits"
          :key="n"
          class="rank-limit"
          :class="{ on: limit === n }"
          @click="onLimit(n)"
        >前 {{ n }} 名</view>
      </view>

      <!-- 空态：还没拉过全市快照 -->
      <view class="rank-empty" v-if="!hasData">
        <text class="rank-empty-big">🚌</text>
        <text class="rank-empty-txt">{{ busy ? '全网扫描中，稍候即可看到榜单…' : '还没有全市车辆快照，点控制卡的「↻ 重扫」拉取' }}</text>
      </view>

      <view class="rank-list" v-else>
        <view
          class="rank-row"
          v-for="r in rows"
          :key="r.busId"
          :class="{ top1: r.rank === 1, top2: r.rank === 2, top3: r.rank === 3 }"
          @click="$emit('pick', r.bus)"
        >
          <text class="rk-no">{{ r.rank }}</text>
          <view class="rk-main">
            <view class="rk-line1">
              <text class="rk-line">{{ r.no }} 路</text>
              <text class="rk-dir" :class="'d' + r.dir">{{ r.dir === 0 ? '上行' : '下行' }}</text>
              <text class="rk-org">{{ r.orgId || '编号还原中' }}</text>
            </view>
            <!-- 走向：起点站开往终点站（下行已按方向反转） -->
            <view class="rk-line2">
              <text class="rk-route" :title="r.routeText">{{ r.routeText }}</text>
            </view>
            <!-- 所属营运公司 + GPS 时刻 -->
            <view class="rk-line3">
              <text class="rk-company" :title="r.company">{{ r.company }}</text>
              <text class="rk-time">{{ r.time }}</text>
            </view>
          </view>
          <view class="rk-speed-wrap">
            <text class="rk-speed" :style="{ color: bandColor(r.band) }">{{ r.speed }}</text>
            <text class="rk-unit">km/h</text>
            <text class="rk-drift" v-if="r.drift" title="速度异常，疑似 GPS 漂移">⚠</text>
          </view>
        </view>
        <view class="rank-foot">
          <text>按当前快照的车速从高到低排序，点任意一行查看车辆详情并定位</text>
          <text v-if="driftCount" class="rank-foot-warn">⚠ {{ driftCount }} 辆疑似 GPS 漂移（&gt;{{ driftSpeed }} km/h），保留在榜仅供参考</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { RANK_LIMITS, DEFAULT_RANK_LIMIT, DRIFT_SPEED, rankBySpeed } from '../utils/speedRank.js'
import { SPEED_BANDS } from '../utils/cityBus.js'

const RANK_LIMIT_KEY = 'whbis:rank-limit'
const RANK_FOLD_KEY = 'whbis:rank-folded'

export default {
  name: 'SpeedRank',
  props: {
    // 全市快照车辆（已去重）；父组件传入，本组件只读
    buses: { type: Array, default: () => [] },
    // 快照元信息 { at, count, ... }
    meta: { type: Object, default: null },
    busy: { type: Boolean, default: false },
  },
  data() {
    return {
      limits: RANK_LIMITS,
      limit: DEFAULT_RANK_LIMIT,
      folded: false,
      driftSpeed: DRIFT_SPEED,
    }
  },
  computed: {
    result() {
      return rankBySpeed(this.buses, this.limit)
    },
    rows() { return this.result.rows },
    total() { return this.result.total },
    hasData() { return this.result.hasData },
    driftCount() { return this.result.driftCount },
    // 明确标注「快照时刻」，不伪装成逐秒实时
    stampText() {
      if (!this.meta || !this.meta.at) return '尚未拉取快照'
      const at = new Date(this.meta.at)
      const hh = (n) => String(n).padStart(2, '0')
      return `${hh(at.getHours())}:${hh(at.getMinutes())}:${hh(at.getSeconds())} 快照`
    },
  },
  created() {
    // 档位与折叠态本机记忆，下次开窗沿用
    try {
      const n = Number(uni.getStorageSync(RANK_LIMIT_KEY))
      if (RANK_LIMITS.includes(n)) this.limit = n
      this.folded = uni.getStorageSync(RANK_FOLD_KEY) === true
    } catch (e) { /* 存储不可用仅本次生效 */ }
  },
  mounted() {
    // 组件可能因切视图被卸载重建：把本机恢复出来的折叠态立即同步给父组件
    this.$emit('fold', !!this.folded)
  },
  watch: {
    folded(v) {
      try { uni.setStorageSync(RANK_FOLD_KEY, !!v) } catch (e) { /* 忽略 */ }
      // 折叠后浮窗高度骤变，通知父组件重新量占位并重排全览
      this.$emit('fold', !!v)
    },
  },
  methods: {
    toggleFold() {
      this.folded = !this.folded
    },
    onLimit(n) {
      if (!RANK_LIMITS.includes(n) || n === this.limit) return
      this.limit = n
      try { uni.setStorageSync(RANK_LIMIT_KEY, n) } catch (e) { /* 忽略 */ }
    },
    bandColor(band) {
      const b = SPEED_BANDS[band]
      return b ? b.color : '#e2e8f0'
    },
  },
}
</script>

<style scoped>
/* 车速榜：沿用全站玻璃浮窗语言，贴右上（全市态右侧栏已隐藏，这块空间空着） */
.rank-card {
  position: absolute;
  top: 24rpx;
  right: 24rpx;
  width: 720rpx;
  max-width: calc(100vw - 48rpx);
  /* 与搜索联想浮层同高（58vh），不占满整屏；列表在内部滚动 */
  max-height: 58vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  z-index: 22;
  background: rgba(11, 16, 32, 0.86);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 28rpx;
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.48);
  overflow: hidden;
}
/* 折叠后只剩标题一条，不再留大片空壳 */
.rank-card.folded {
  max-height: none;
}
.rank-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 20rpx 24rpx 16rpx;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  user-select: none;
}
.rank-card.folded .rank-head {
  border-bottom: none;
}
.rank-head:hover .rank-title { color: #fff; }
.rank-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}
.rank-title {
  font-size: 27rpx;
  font-weight: 800;
  color: #fff;
}
.rank-sub {
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.44);
}
.rank-head-ops {
  flex: 0 0 auto;
  display: flex;
  gap: 8rpx;
}
.rank-mini {
  min-width: 44rpx;
  height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.66);
  background: rgba(255, 255, 255, 0.07);
  cursor: pointer;
}
.rank-mini:hover { color: #fff; background: rgba(var(--ac-rgb), 0.24); }
/* 折叠箭头：与设置面板分区箭头同一套旋转语义 */
.rank-mini.fold-btn {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.42);
  background: transparent;
  transition: transform 0.18s ease;
}
.rank-mini.fold-btn.folded { transform: rotate(-90deg); }

.rank-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 档位胶囊 */
.rank-limits {
  flex: 0 0 auto;
  display: flex;
  gap: 10rpx;
  padding: 16rpx 24rpx 12rpx;
}
.rank-limit {
  flex: 1;
  text-align: center;
  padding: 10rpx 0;
  border-radius: 12rpx;
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.rank-limit:hover { background: rgba(255, 255, 255, 0.1); }
.rank-limit.on {
  color: #fff;
  font-weight: 700;
  background: rgba(var(--ac-rgb), 0.22);
  border-color: rgba(var(--ac-rgb), 0.55);
}

.rank-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: 60rpx 30rpx;
}
.rank-empty-big { font-size: 56rpx; }
.rank-empty-txt { font-size: 22rpx; color: rgba(255, 255, 255, 0.45); text-align: center; line-height: 1.6; }

/* 榜单：普通 view + overflow-y 自己滚（与车辆面板同一套，避免 scroll-view 在 flex 限高下撑破）。
   滚动条沿用全站统一规格：细 8rpx 轨 + 半透明白滑块 + 惯性不穿透到地图页 */
.rank-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 16rpx 16rpx;
}
.rank-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  /* 三行信息（线路 / 走向 / 公司+时间），略收紧纵向留白保持一屏能看多行 */
  padding: 11rpx 12rpx;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.06);
  border-radius: 12rpx;
  cursor: pointer;
  transition: background 0.15s;
}
.rank-row:hover { background: rgba(255, 255, 255, 0.07); }
.rk-no {
  flex: 0 0 46rpx;
  text-align: center;
  font-size: 26rpx;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.4);
}
.rank-row.top1 .rk-no { color: #fcd34d; font-size: 30rpx; }
.rank-row.top2 .rk-no { color: #e2e8f0; }
.rank-row.top3 .rk-no { color: #fdba74; }
.rk-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.rk-line1 {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}
.rk-line {
  font-size: 25rpx;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}
.rk-dir {
  flex: 0 0 auto;
  padding: 1rpx 9rpx;
  border-radius: 7rpx;
  font-size: 18rpx;
}
.rk-dir.d0 { color: #67e8f9; background: rgba(6, 182, 212, 0.18); }
.rk-dir.d1 { color: #fda4af; background: rgba(225, 29, 72, 0.18); }
.rk-org {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 20rpx;
  color: #fcd34d;
}
/* 走向：站名往往很长，整行单行省略，完整内容放 title */
.rk-line2 {
  display: flex;
  min-width: 0;
}
.rk-route {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.62);
}
/* 营运公司 + GPS 时刻：公司用冷灰，与自编号的琥珀区分开，避免一行三种亮色 */
.rk-line3 {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
  font-size: 18rpx;
}
.rk-company {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.4);
}
.rk-time { flex: 0 0 auto; color: rgba(255, 255, 255, 0.36); }
.rk-speed-wrap {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}
.rk-speed {
  font-size: 36rpx;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.rk-unit { font-size: 18rpx; color: rgba(255, 255, 255, 0.45); }
.rk-drift { font-size: 18rpx; margin-left: 4rpx; }
.rank-foot {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 16rpx 12rpx 6rpx;
  font-size: 18rpx;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.36);
}
.rank-foot-warn { color: #fbbf24; }
</style>
