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
    <!-- 线路号徽章 + 所属营运公司徽标：紧跟在标题下方，仅在有线路号时显示 -->
    <view class="plan-line-info" v-if="lineName">
      <view class="pli-badge">{{ lineName }}{{ roadUnit ? '路' : '' }}</view>
      <view class="pli-companies" v-if="operatorCompanies.length || orgBadge">
        <view class="org-tag" v-for="c in operatorCompanies" :key="c.no" :title="c.label">
          <text class="org-no">{{ c.no }}</text>
          <text class="org-name">{{ c.short }}</text>
        </view>
        <view class="org-tag foreign" v-if="orgBadge" :title="orgBadge.full">
          <image class="org-logo" :src="companyLogo" mode="aspectFit" />
          <text class="org-name">{{ orgBadge.label }}</text>
        </view>
      </view>
    </view>
    <!-- 工具行：与车辆面板 .panel-tools 同构（左提示，右复制按钮） -->
    <view class="plan-tools">
      <!-- 环形线没有上下行：不再拆上/下行计数，只报总班次 + 环形提示 -->
      <text class="ph-hint" v-if="isLoop">{{ totalCount }} 班 · 环形</text>
      <text class="ph-hint" v-else>{{ sortedByDir[0].length }} 上行 · {{ sortedByDir[1].length }} 下行</text>
      <CopyPill label="导出" :disabled="!totalCount" @copy="copyPlans" />
    </view>

    <view class="plan-body" v-show="!collapsed">
      <view class="plan-group" v-for="g in groups" :key="g.key">
        <!-- 分组头：方向徽标（与车辆列表的 .bus-dir 同一尺寸与着色） + 该方向班次数 -->
        <view class="pg-head">
          <text class="pg-dir" :class="g.loop ? 'loop' : 'd' + g.dir">{{ g.label }}</text>
          <text class="pg-count">{{ g.plans.length }} 班</text>
        </view>

        <view class="plan-row" v-for="(p, i) in g.plans" :key="p.busId || i" :title="planTip(p, g)">
          <!-- 左：自编号 + 车型（沿用车辆面板字体风格）；右：发车时间 -->
          <view class="plan-left">
            <text class="plan-org" v-if="p.bus">{{ fmtNo(p.bus) }}</text>
            <text class="plan-model" v-if="p.bus && busModel(p.bus)">🚌 {{ busModel(p.bus) }}</text>
          </view>
          <view class="plan-time-wrap">
            <text class="plan-badge departed" v-if="planStatus(p) === 'departed'">已发</text>
            <text class="plan-badge pending" v-else-if="planStatus(p) === 'pending'">待发</text>
            <text class="plan-time">{{ p.planStartTime || '--' }}</text>
          </view>
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
import { formatBusNo, getBusModel, onBusNumberReady } from '../utils/busNumber.js'
import { orgCompanyOf } from '../utils/speedRank.js'
import CopyPill from './CopyPill.vue'

// 方向常量：0 上行 / 1 下行（两方向同屏，顺序与地图控制卡一致）
const DIRS = [0, 1]

export default {
  name: 'LinePlan',
  components: { CopyPill },
  props: {
    lineNo: { type: String, default: '' },
    // 当前在线车辆标识（busId MD5 + 纯数字自编号），用于判定班次是否已实际发出
    onlineBusKeys: { type: Array, default: () => [] },
    // 当前线路展示名（如 337 / H81），用于在面板标题下方显示线路号徽章
    lineName: { type: String, default: '' },
    // 是否在数字后显示「路」字（内环/外环/内线/外线不加）
    roadUnit: { type: Boolean, default: true },
    // 所属营运公司列表，每项 { no, short, label }
    operatorCompanies: { type: Array, default: () => [] },
    // 非集团线路的公司徽标（来自公司字典），{ full, label }
    orgBadge: { type: Object, default: null },
    // 公司 Logo URL
    companyLogo: { type: String, default: '' },
  },
  data() {
    return {
      // 完整编号映射加载版本号（就绪后 ++，触发班次自编号显示刷新）
      mapVersion: 0,
      DIRS,
      // 双方向各存一份：/detailPlanTime 按方向（lineId 末位 0|1）分别拉
      plansByDir: { 0: [], 1: [] },
      loading: false,
      // 已发出班次的持久记录：key=班次 id（busId 优先，退化用 bus|时间），value=true。
      // 一旦车在线命中就记下，到终点下线后不再复活；换线路时清空。
      departedIds: {},
      // 折叠只收班次列表，标题行常驻（与实时车辆面板的 ▾ 同一语义）
      collapsed: false,
    }
  },
  computed: {
    // 是否环形线路：环形无上下行，合并成一组「环形」
    isLoop() {
      return isLoopLine(this.lineNo)
    },
    // 各方向按计划发车时间升序、并剔除已发班次（后端 startOrder 不可靠，序号由排序生成）
    sortedByDir() {
      const by = (a, b) => (a.planStartTime || '').localeCompare(b.planStartTime || '')
      const visible = (arr) => arr.filter((p) => !this.isDeparted(p)).sort(by)
      return { 0: visible(this.plansByDir[0]), 1: visible(this.plansByDir[1]) }
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
    // 换线路：丢弃上一条的班次与已发记录再拉
    lineNo(v) {
      if (!v) return
      this.plansByDir = { 0: [], 1: [] }
      this.departedIds = {}
      this.loadPlan()
    },
    // 在线车辆刷新：新上线的车即时补记为已发，班次随即从时刻表移除
    onlineBusKeys() {
      this.markDeparted()
    },
  },
  mounted() {
    this.loadPlan()
    // 车辆自编号靠 MD5 字典还原：字典还没建好时先订阅，就绪后补拉一次
    if (!isBusIdReady()) onBusIdReady(() => this.loadPlan())
    // 完整编号映射加载完成后刷新显示
    onBusNumberReady(() => { this.mapVersion++ })
  },
  methods: {
    // 纯数字自编号 → 完整编号（依赖 mapVersion，映射就绪后重渲染）
    fmtNo(orgId) {
      void this.mapVersion
      return formatBusNo(orgId)
    },
    // 车辆具体型号（buspedia 自编号映射的 model 字段）
    busModel(orgId) {
      void this.mapVersion
      return getBusModel(orgId)
    },
    // 班次稳定 id：优先 busId（MD5，跨刷新稳定），缺失时退化用 自编号|发车时刻
    planKey(p) {
      return p.busId || `${p.bus || ''}|${p.planStartTime || ''}`
    },
    // 已发班次是否应从时刻表移除：命中持久 departedIds，或当前在线（watch 会补记，避免渲染时序漏判）
    isDeparted(p) {
      return !!this.departedIds[this.planKey(p)] || this.isBusOnline(p)
    },
    // 扫描班次：凡当前在线的，记入 departedIds 永久标记为已发（车下线后不复活）。
    // 在 onlineBusKeys 变化时调用；返回是否有新增，便于按需跳过无谓渲染。
    markDeparted() {
      const keys = this.onlineBusKeys || []
      if (!keys.length) return
      let changed = false
      for (const d of [0, 1]) {
        for (const p of (this.plansByDir[d] || [])) {
          if (!this.departedIds[this.planKey(p)] && this.isBusOnline(p)) {
            this.$set(this.departedIds, this.planKey(p), true)
            changed = true
          }
        }
      }
      return changed
    },
    // 该班次是否「待发」：计划发车时间晚于当前时刻（当天未到点）。
    // planStartTime 为 HH:MM，只比时刻不比日期；已过点的班次不标。
    isPending(p) {
      const t = String(p.planStartTime || '').trim()
      const m = t.match(/^(\d{1,2}):(\d{2})$/)
      if (!m) return false
      const now = new Date()
      const hh = parseInt(m[1], 10)
      const mm = parseInt(m[2], 10)
      // 与当前时刻比较：晚于当前即待发；同分钟及以上已过点
      return (hh > now.getHours()) || (hh === now.getHours() && mm > now.getMinutes())
    },
    // 班次车辆是否已在线运行：用 busId(MD5) 或还原的纯数字自编号命中在线集合。
    // 已在线说明车实际上路（可能提前发车），此时不能再显示「待发」。
    isBusOnline(p) {
      const keys = this.onlineBusKeys || []
      if (!keys.length) return false
      const id = String(p.busId || '').toLowerCase()
      const no = String(p.bus || '')
      return keys.some((k) => {
        const s = String(k)
        return (id && s.toLowerCase() === id) || (no && s === no)
      })
    },
    // 班次综合状态：departed=已在线（含提前发出）/ pending=未在线且未到点 / ''=已过点且未在线
    planStatus(p) {
      if (this.isBusOnline(p)) return 'departed'
      return this.isPending(p) ? 'pending' : ''
    },
    // 班次行悬浮提示：与实时车辆面板 busTip 同构（原生 title）。
    // 计划发车无实时位置/速度，展示方向 / 完整自编号 / 营运公司 / 发车时刻 / MD5 原值备查。
    planTip(p, g) {
      const no = p.bus ? this.fmtNo(p.bus) : (p.orgBusNo || '未知编号')
      const model = p.bus ? (this.busModel(p.bus) || '车型未知') : ''
      const company = p.bus ? orgCompanyOf({ orgId: p.bus }) : '未知公司'
      const dir = g && g.name ? g.name : this.dirLabel(p.dir)
      const time = p.planStartTime || '--'
      const hash = p.busId ? `\n车辆编号：${p.busId}` : ''
      return `${dir} · ${no} · ${model} · ${company}\n计划发车：${time}${hash}`
    },
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
      // 班次刚到时在线车辆可能早已就位（watch 不会因它再变），主动标记一次避免漏判
      this.markDeparted()
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
          rows.push([g.name, p.planStartTime || '--', p.bus ? this.fmtNo(p.bus) : '--'])
        })
      })
      if (!rows.length) { uni.showToast({ title: '暂无可复制班次', icon: 'none' }); return }
      copyTable({
        title: `${this.lineNo || ''} 发车时刻（共 ${rows.length} 班）`,
        columns: ['方向', '发车时间', '车辆'],
        rows,
        toast: `已复制 ${rows.length} 班时刻`,
        imageToast: `已导出 ${rows.length} 班时刻图片`,
        excelToast: `已导出 ${rows.length} 班时刻 Excel 文件`,
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
/* 线路号徽章 + 营运公司徽标行：紧跟在面板标题下方，仅在有线路号时显示 */
.plan-line-info {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 4rpx 14rpx;
  flex-wrap: nowrap;
  min-width: 0;
  border-bottom: 1rpx solid rgba(255, 255, 255, 0.06);
}
.pli-badge {
  flex-shrink: 0;
  height: 32rpx;
  padding: 0 14rpx;
  border-radius: 999rpx;
  background: rgba(var(--ac-rgb), 0.18);
  border: 2rpx solid rgba(var(--ac-rgb), 0.45);
  font-size: 22rpx;
  font-weight: 800;
  color: var(--ac-text);
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.pli-companies {
  display: flex;
  align-items: center;
  gap: 6rpx;
  margin-left: auto;
  flex-shrink: 0;
}
/* 所属营运公司徽标：与实时车辆面板（LineMap.vue）逐字同款，全站统一 */
.org-tag {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.18), rgba(251, 191, 36, 0.06));
  border: 2rpx solid rgba(251, 191, 36, 0.42);
  border-radius: 999rpx;
  padding: 2rpx 18rpx 2rpx 2rpx;
  white-space: nowrap;
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.14), 0 3rpx 8rpx rgba(251, 191, 36, 0.12);
}
.org-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  font-size: 24rpx;
  font-weight: 800;
  color: #1a1205;
  background: linear-gradient(135deg, #fde68a, #fbbf24 45%, #f59e0b);
  box-shadow: 0 4rpx 12rpx rgba(251, 191, 36, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.6),
    inset 0 -2rpx 4rpx rgba(180, 83, 9, 0.3);
  margin-right: 10rpx;
  flex-shrink: 0;
}
.org-name {
  font-size: 18rpx;
  line-height: 1;
  font-weight: 700;
  color: #fde68a;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1rpx 2rpx rgba(0, 0, 0, 0.3);
}
.org-logo {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  margin-right: 10rpx;
  flex-shrink: 0;
}
.org-tag.foreign {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.18);
}
.org-tag.foreign .org-name {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 700;
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
  margin: 12rpx 0 18rpx;
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
   tabular-nums 保证数字对齐不跳动。flex 交给外层 .plan-time-wrap，徽标不会被挤出 */
.plan-time {
  min-width: 0;
  text-align: right;
  font-size: 42rpx;
  font-weight: 800;
  color: var(--ac-hi);
  font-variant-numeric: tabular-nums;
  letter-spacing: 1rpx;
}
/* 时间 + 待发徽标：整块靠右，flex:1 承接行剩余宽度 */
.plan-time-wrap {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10rpx;
}
/* 状态徽标：小胶囊紧贴时间左侧，不占主色也不抢数字。
   pending=待发（琥珀）/ departed=已发（绿，车辆已在线，含提前发出） */
.plan-badge {
  flex: 0 0 auto;
  padding: 2rpx 12rpx;
  border-radius: 10rpx;
  font-size: 19rpx;
  font-weight: 700;
  line-height: 1.4;
}
.plan-badge.pending {
  color: #fcd34d;
  background: rgba(252, 211, 77, 0.14);
  border: 1rpx solid rgba(252, 211, 77, 0.3);
}
.plan-badge.departed {
  color: #6ee7b7;
  background: rgba(16, 185, 129, 0.14);
  border: 1rpx solid rgba(16, 185, 129, 0.32);
}
/* 左侧：自编号 + 车型，纵向排列（右侧时间保持单列） */
.plan-left {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
/* 车辆自编号：直接沿用车辆面板 .bus-org 的字体风格（34rpx / 800 / 主色 / 等宽数字），
   去掉胶囊底与图标，纯文字与右侧时间共用同一套字体语言 */
.plan-org {
  font-size: 34rpx;
  font-weight: 800;
  color: var(--ac-hi);
  font-variant-numeric: tabular-nums;
}
/* 车辆型号：自编号下方小字，过长省略 */
.plan-model {
  font-size: 19rpx;
  color: rgba(var(--ac-rgb), 0.85);
  margin-top: 2rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
