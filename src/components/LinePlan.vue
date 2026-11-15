<template>
  <!-- 发车时刻表面板：挂在地图右侧栏、实时车辆面板下方，独立成块可折叠。
       上行与下行同时列出（各一组），不再随控制卡视角二选一；
       版式与车辆面板同出一辙（标题行 + 折叠键 + 列表），字号完全对齐：
       标题 30rpx / 方向徽标 20rpx / 主数据 34rpx / 次要 24rpx / 提示 20rpx / 空态 26rpx -->
  <view class="plans" :class="{ folded: collapsed }">
    <!-- 标题栏：与车辆面板 .panel-header 同构（左标题含计数，右折叠键） -->
    <view class="plan-head">
      <view class="plan-title">🕐 发车时刻（共 {{ totalCount }} 班）</view>
      <view class="ph-fold" :class="{ folded: collapsed }" @click="collapsed = !collapsed" :title="collapsed ? '展开' : '折叠'">▾</view>
    </view>
    <!-- 工具行：与车辆面板 .panel-tools 同构（左提示，右复制按钮） -->
    <view class="plan-tools">
      <!-- 环形线没有上下行：不再拆上/下行计数，只报总班次 + 环形提示 -->
      <text class="ph-hint" v-if="isLoop">{{ totalCount }} 班 · 环形</text>
      <text class="ph-hint" v-else>{{ sortedByDir[0].length }} 上行 · {{ sortedByDir[1].length }} 下行</text>
      <CopyPill label="复制" :disabled="!totalCount" @copy="copyPlans" />
    </view>

    <view class="plan-body" v-show="!collapsed">
      <view class="plan-group" v-for="g in groups" :key="g.key">
        <!-- 分组头：方向徽标（与车辆列表的 .bus-dir 同一尺寸与着色） + 该方向班次数 -->
        <view class="pg-head">
          <text class="pg-dir" :class="g.loop ? 'loop' : 'd' + g.dir">{{ g.label }}</text>
          <text class="pg-count">{{ g.plans.length }} 班</text>
        </view>

        <view class="plan-row" v-for="(p, i) in g.plans" :key="p.busId || i">
          <!-- 左：车辆自编号（沿用车辆面板 .bus-org 字体：主色 800 等宽数字，无图标无胶囊）；右：发车时间 -->
          <text class="plan-org" v-if="p.bus">{{ p.bus }}</text>
          <text class="plan-time">{{ p.planStartTime || '--' }}</text>
        </view>

        <view class="plan-empty" v-if="!g.plans.length">
          <view class="empty-icon">{{ loading ? '⏳' : '🚏' }}</view>
          <text class="empty-text">{{ loading ? '时刻表加载中…' : (g.loop ? '暂无环形计划发车数据' : '暂无' + g.name + '计划发车数据') }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { fetchPlanTime, decryptBusId, onBusIdReady, isBusIdReady } from '../utils/api.js'
import { buildLineCode } from '../config.js'
import { isLoopLine } from '../utils/lineIndex.js'
import { copyTable } from '../utils/clipboard.js'
import CopyPill from './CopyPill.vue'

// 方向常量：0 上行 / 1 下行（两方向同屏，顺序与地图控制卡一致）
const DIRS = [0, 1]

export default {
  name: 'LinePlan',
  components: { CopyPill },
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
    // 是否环形线路：环形无上下行，合并成一组「环形」
    isLoop() {
      return isLoopLine(this.lineNo)
    },
    // 各方向按计划发车时间升序（后端 startOrder 不可靠，班次序号由排序生成）
    sortedByDir() {
      const by = (a, b) => (a.planStartTime || '').localeCompare(b.planStartTime || '')
      return { 0: [...this.plansByDir[0]].sort(by), 1: [...this.plansByDir[1]].sort(by) }
    },
    // 展示分组：普通线路分上行/下行两组；环形线合并为一组「环形」
    // （去重，避免两方向返回同一班次时重复列出）
    groups() {
      if (!this.isLoop) {
        return DIRS.map((d) => ({
          key: 'd' + d,
          dir: d,
          name: d === 0 ? '上行' : '下行',
          label: d === 0 ? '↑ 上行' : '↓ 下行',
          loop: false,
          plans: this.sortedByDir[d],
        }))
      }
      const seen = new Set()
      const plans = this.sortedByDir[0]
        .concat(this.sortedByDir[1])
        .sort((a, b) => (a.planStartTime || '').localeCompare(b.planStartTime || ''))
        .filter((p) => {
          const key = p.busId || `${p.planStartTime || ''}|${p.bus || ''}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      return [{ key: 'loop', dir: 0, name: '环形', label: '⟳ 环形', loop: true, plans }]
    },
    totalCount() {
      return this.groups.reduce((n, g) => n + g.plans.length, 0)
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
      // 换线时在途请求不会自动作废：每次加载发一个令牌，回来时已有更新的加载在跑就丢弃结果，
      // 否则上一条线路的慢响应会盖掉新线路的班次（时刻表残留旧线路的根因）
      const token = (this._planToken = (this._planToken || 0) + 1)
      if (!this.lineNo) {
        this.plansByDir = { 0: [], 1: [] }
        return
      }
      this.loading = true
      // 两个方向独立成败：一边报错不拖累另一边（空数组是后端常态，不算错误）
      const [up, down] = await Promise.all(
        DIRS.map((d) => this.fetchDir(this.lineNo, d).catch((e) => (token !== this._planToken ? [] : this.warn(d, e))))
      )
      if (token !== this._planToken) return // 已切线路，丢弃过期响应
      this.plansByDir = { 0: up, 1: down }
      this.loading = false
    },
    // 方向文案：环形线统一「环形」，普通线路「上行 / 下行」
    dirLabel(dir) {
      return this.isLoop ? '环形' : (dir === 0 ? '上行' : '下行')
    },
    // 拉取失败：该方向置空（走空态文案），只提示一次
    warn(dir, e) {
      uni.showToast({ title: `${this.dirLabel(dir)}时刻表加载失败：${e.message}`, icon: 'none' })
      return []
    },
    // 一键复制全部班次时刻：文本/图片由「设置 → 复制方式」统一决定
    copyPlans() {
      const rows = []
      // 直接按展示分组导出：普通线路方向列是「上行/下行」，环形线统一「环形」
      this.groups.forEach((g) => {
        g.plans.forEach((p) => {
          rows.push([g.name, p.planStartTime || '--', p.bus || '--'])
        })
      })
      if (!rows.length) { uni.showToast({ title: '暂无可复制班次', icon: 'none' }); return }
      copyTable({
        title: `${this.lineNo || ''} 发车时刻（共 ${rows.length} 班）`,
        columns: ['方向', '发车时间', '车辆'],
        rows,
        toast: `已复制 ${rows.length} 班时刻`,
        imageToast: `已复制 ${rows.length} 班时刻为图片`,
        excelToast: `已复制 ${rows.length} 班时刻为 Excel 表格`,
      })
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
/* ---- 标题栏：与车辆面板 .panel-header 同构（左标题含计数 + 右折叠键） ---- */
.plan-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  margin-bottom: 18rpx;
}
/* 折叠态只留标题栏，底部间距收回（同 .panel.collapsed .panel-header） */
.plans.folded .plan-head {
  margin-bottom: 0;
}
.plan-title {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  font-weight: 700;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 工具行：与车辆面板 .panel-tools 同构（左提示，右复制按钮） */
.plan-tools {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  margin-bottom: 18rpx;
}
.plans.folded .plan-tools {
  margin-bottom: 0;
}
.ph-hint {
  flex: 1;
  min-width: 0;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.42);
  text-align: left;
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
  background: rgba(var(--ac-rgb), 0.3);
}
.ph-fold.folded {
  transform: rotate(-90deg);
}
/* ---- 班次列表：上下行两组同屏，卡高不够时整块自己滚 ---- */
.plan-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  /* 滚到顶/底不要把惯性传给地图，也别让细滚动条压在时间数字上 */
  overscroll-behavior: contain;
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
/* 环形线路：合并组徽标用独立紫罗兰色 */
.pg-dir.loop {
  color: #ddd6fe;
  background: rgba(139, 92, 246, 0.18);
  border: 2rpx solid rgba(167, 139, 250, 0.45);
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
  justify-content: space-between;
  gap: 16rpx;
  padding: 22rpx 0;
  border-top: 2rpx solid rgba(255, 255, 255, 0.08);
}
/* 主数据：发车时间 — 与车辆面板 .bus-org 同色（var(--ac-hi)）、同字重，
   tabular-nums 保证数字对齐不跳动 */
.plan-time {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 42rpx;
  font-weight: 800;
  color: var(--ac-hi);
  font-variant-numeric: tabular-nums;
  letter-spacing: 1rpx;
  line-height: 1;
}
/* 车辆自编号：直接沿用车辆面板 .bus-org 的字体风格（34rpx / 800 / 主色 / 等宽数字），
   去掉胶囊底与图标，纯文字与右侧时间共用同一套字体语言 */
.plan-org {
  flex: 0 0 auto;
  font-size: 34rpx;
  font-weight: 800;
  color: var(--ac-hi);
  font-variant-numeric: tabular-nums;
}
/* 空态（该方向无班次 / 加载中）：图标 + 文字双行居中 */
.plan-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 0;
  border-top: 2rpx solid rgba(255, 255, 255, 0.08);
}
.empty-icon {
  font-size: 72rpx;
  margin-bottom: 12rpx;
  opacity: 0.8;
}
.empty-text {
  color: rgba(255, 255, 255, 0.5);
  font-size: 26rpx;
}
</style>
