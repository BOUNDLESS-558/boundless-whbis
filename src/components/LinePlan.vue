<template>
  <!-- 发车时刻表面板：挂在地图右侧栏、实时车辆面板下方，独立成块可折叠。
       上行与下行同时列出（各一组），不再随控制卡视角二选一；
       版式与车辆面板同出一辙（标题行 + 折叠键 + 列表），字号完全对齐：
       标题 30rpx / 方向徽标 20rpx / 主数据 34rpx / 次要 24rpx / 提示 20rpx / 空态 26rpx -->
  <view class="plans" :class="{ folded: collapsed }">
    <view class="plan-head">
      <text class="ph-title">🕐 发车时刻</text>
      <text class="ph-count">共 {{ totalCount }} 班</text>
      <view class="ph-fold" :class="{ folded: collapsed }" @click="collapsed = !collapsed" :title="collapsed ? '展开' : '折叠'">▾</view>
    </view>

    <view class="plan-body" v-show="!collapsed">
      <view class="plan-group" v-for="d in DIRS" :key="'g' + d">
        <!-- 分组头：方向徽标（与车辆列表的 .bus-dir 同一尺寸与着色） + 该方向班次数 -->
        <view class="pg-head">
          <text class="pg-dir" :class="'d' + d">{{ d === 0 ? '上行' : '下行' }}</text>
          <text class="pg-count">{{ sortedByDir[d].length }} 班</text>
        </view>

        <view class="plan-row" v-for="(p, i) in sortedByDir[d]" :key="p.busId || i">
          <text class="plan-order">第 {{ i + 1 }} 班</text>
          <text class="plan-time">{{ p.planStartTime || '--' }}</text>
          <text class="plan-org">车辆 {{ p.bus || '--' }}</text>
        </view>

        <view class="plan-empty" v-if="!sortedByDir[d].length">
          <text class="empty-text">{{ loading ? '时刻表加载中…' : '暂无' + (d === 0 ? '上行' : '下行') + '计划发车数据' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { fetchPlanTime, decryptBusId, onBusIdReady, isBusIdReady } from '../utils/api.js'
import { buildLineCode } from '../config.js'

// 方向常量：0 上行 / 1 下行（两方向同屏，顺序与地图控制卡一致）
const DIRS = [0, 1]

export default {
  name: 'LinePlan',
  props: {
    lineNo: { type: String, default: '' },
  },
  data() {
    return {
      DIRS,
      // 双方向各存一份：/detailPlanTime 按方向（lineId 末位 0|1）分别拉
      plansByDir: { 0: [], 1: [] },
      loading: false,
      // 折叠只收班次列表，标题行常驻（与实时车辆面板的 ▾ 同一语义）
      collapsed: false,
    }
  },
  computed: {
    // 各方向按计划发车时间升序（后端 startOrder 不可靠，班次序号由排序生成）
    sortedByDir() {
      const by = (a, b) => (a.planStartTime || '').localeCompare(b.planStartTime || '')
      return { 0: [...this.plansByDir[0]].sort(by), 1: [...this.plansByDir[1]].sort(by) }
    },
    totalCount() {
      return this.sortedByDir[0].length + this.sortedByDir[1].length
    },
  },
  watch: {
    // 换线路：丢弃上一条的班次再拉
    lineNo(v) {
      if (!v) return
      this.plansByDir = { 0: [], 1: [] }
      this.loadPlan()
    },
  },
  mounted() {
    this.loadPlan()
    // 车辆自编号靠 MD5 字典还原：字典还没建好时先订阅，就绪后补拉一次
    if (!isBusIdReady()) onBusIdReady(() => this.loadPlan())
  },
  methods: {
    // 单个方向的计划发车（/detailPlanTime 用 lineId，格式与 lineCode 相同）
    async fetchDir(no, dir) {
      const data = await fetchPlanTime(buildLineCode(no, dir))
      const arr = Array.isArray(data) ? data : []
      return arr.map((p) => ({
        ...p,
        dir,
        bus: p.orgBusId || p.orgBusNo || decryptBusId(p.busId) || '',
      }))
    },
    async loadPlan() {
      if (!this.lineNo) {
        this.plansByDir = { 0: [], 1: [] }
        return
      }
      this.loading = true
      // 两个方向独立成败：一边报错不拖累另一边（空数组是后端常态，不算错误）
      const [up, down] = await Promise.all(
        DIRS.map((d) => this.fetchDir(this.lineNo, d).catch((e) => this.warn(d, e)))
      )
      this.plansByDir = { 0: up, 1: down }
      this.loading = false
    },
    // 拉取失败：该方向置空（走空态文案），只提示一次
    warn(dir, e) {
      uni.showToast({ title: `${dir === 0 ? '上行' : '下行'}时刻表加载失败：${e.message}`, icon: 'none' })
      return []
    },
  },
}
</script>

<style scoped>
.plans {
  display: flex;
  flex-direction: column;
  /* 宿主（.plan-side）给高度：标题行固定，班次列表吃掉余下空间并自己滚 */
  flex: 1 1 auto;
  min-height: 0;
}
/* ---- 标题行：与 .panel-header 同构（左标题 + 右折叠键） ---- */
.plan-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 14rpx;
}
/* 折叠态只留标题行，底部间距收回（同 .panel.collapsed .panel-header） */
.plans.folded .plan-head {
  margin-bottom: 0;
}
.ph-title {
  flex: 0 0 auto;
  font-size: 30rpx;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}
/* 班次合计：贴右，字号取面板提示文字 .pt-hint 的 20rpx */
.ph-count {
  flex: 1;
  min-width: 0;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.42);
  text-align: right;
  white-space: nowrap;
}
/* 折叠键：与车辆面板的 .collapse-btn 同一枚圆键 */
.ph-fold {
  flex: 0 0 auto;
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 30rpx;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border: 2rpx solid rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: transform 0.25s, background 0.2s;
}
.ph-fold:hover {
  background: rgba(129, 140, 248, 0.3);
}
.ph-fold.folded {
  transform: rotate(-90deg);
}
/* ---- 班次列表：上下行两组同屏 ---- */
.plan-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
/* 分组头：整行压在方向色上，与车辆列表里的分组感一致 */
.pg-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 0 6rpx;
}
/* 方向徽标：与车辆列表里的 .bus-dir 同一尺寸与着色规则 */
.pg-dir {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34rpx;
  padding: 0 10rpx;
  border-radius: 8rpx;
  font-size: 20rpx;
  font-weight: 800;
}
.pg-dir.d0 {
  color: #67e8f9;
  background: rgba(6, 182, 212, 0.18);
  border: 2rpx solid rgba(34, 211, 238, 0.45);
}
.pg-dir.d1 {
  color: #fda4af;
  background: rgba(225, 29, 72, 0.18);
  border: 2rpx solid rgba(251, 113, 133, 0.45);
}
.pg-count {
  flex: 1;
  min-width: 0;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.42);
  text-align: right;
  white-space: nowrap;
}
/* 行分隔线与 .bus-item 同一条（2rpx / 0.08），行高一致 */
.plan-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 22rpx 0;
  border-top: 2rpx solid rgba(255, 255, 255, 0.08);
}
.plan-order {
  flex: 0 0 auto;
  width: 110rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.55);
}
/* 发车时间 = 这行的主数据，与车辆面板的自编号同号 */
.plan-time {
  flex: 1;
  min-width: 0;
  font-size: 34rpx;
  font-weight: 800;
  color: #a5b4fc;
  font-variant-numeric: tabular-nums;
}
.plan-org {
  flex: 0 0 auto;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}
/* 空态（该方向无班次 / 加载中）：与车辆面板 .empty 同字号同留白 */
.plan-empty {
  padding: 40rpx 0;
  border-top: 2rpx solid rgba(255, 255, 255, 0.08);
  text-align: center;
}
.empty-text {
  color: rgba(255, 255, 255, 0.5);
  font-size: 26rpx;
}
</style>
