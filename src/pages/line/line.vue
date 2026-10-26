<template>
  <view class="page">
    <!-- 头部：线路号 + 起终点 + 营运信息（毛玻璃） -->
    <view class="hero glass">
      <view class="hero-top">
        <view class="badge">{{ lineName }}</view>
        <view class="route">
          <text class="route-start">{{ activeBase.startStop || startStopOpt || '起点' }}</text>
          <text class="route-arrow">⇌</text>
          <text class="route-end">{{ activeBase.endStop || endStopOpt || '终点' }}</text>
        </view>
        <!-- 营运公司（由车辆自编号首位推断） -->
        <view class="org-tags" v-if="operatorCompanies.length">
          <view class="org-tag" v-for="c in operatorCompanies" :key="c.no">
            <text class="org-no">{{ c.no }}</text>
            <text class="org-name">{{ c.label }}</text>
          </view>
        </view>
      </view>
      <view class="ops">
        <view class="ops-item">
          <text class="ops-value">{{ activeBase.earlyHour || '--' }}</text>
          <text class="ops-label">首班</text>
        </view>
        <view class="ops-item">
          <text class="ops-value">{{ activeBase.lastHour || '--' }}</text>
          <text class="ops-label">末班</text>
        </view>
        <view class="ops-item">
          <text class="ops-value">¥{{ activeBase.price || '--' }}</text>
          <text class="ops-label">票价</text>
        </view>
        <view class="ops-item">
          <text class="ops-value">{{ activeCols.length }}</text>
          <text class="ops-label">站点</text>
        </view>
        <view class="ops-item ops-click" @click="copyOnlineBuses">
          <text class="ops-value online">{{ onlineCount }}</text>
          <text class="ops-label online-label">在线</text>
        </view>
      </view>
    </view>

    <!-- Tab 分段控件 -->
    <view class="tabs glass-soft">
      <view class="tab" :class="{ active: currentTab === 'stops' }" @click="switchTab('stops')">实时线路</view>
      <view class="tab" :class="{ active: currentTab === 'plan' }" @click="switchTab('plan')">时刻表</view>
    </view>

    <!-- 实时线路 -->
    <view v-if="currentTab === 'stops'" class="stops-wrap">
      <!-- 方向切换 -->
      <view class="dir-switch glass-soft">
        <view class="dir-opt up" :class="{ active: activeDir === 0 }" @click="setDir(0)">▲ 上行</view>
        <view class="dir-opt down" :class="{ active: activeDir === 1 }" @click="setDir(1)">▼ 下行</view>
      </view>

      <view class="live-tip">
        <view class="lt-info">
          <text class="lt-count">共 {{ activeCols.length }} 站 · {{ onlineCount }} 辆在线</text>
          <text class="upd" v-if="lastUpdate">更新于 {{ lastUpdate }}</text>
        </view>
        <!-- 刷新控件：与地图页 .refresh-pill 同一套设计 ——
             左半 ↻ 立即拉一次，右半显示当前间隔并可展开 手动 / 15 / 20 / 30 秒 -->
        <view class="refresh-wrap">
          <view class="refresh-pill" :class="{ busy: loading, auto: refreshSec > 0 }">
            <view class="rp-refresh" @click="onRefresh" :title="loading ? '刷新中…' : '立即刷新'">
              <text class="rp-ico" :class="{ spin: loading }">↻</text>
            </view>
            <view class="rp-split"></view>
            <view class="rp-mode" @click="refreshMenu = !refreshMenu" :title="refreshTitle">
              <text class="rp-txt">{{ refreshLabel }}</text>
              <text class="rp-caret" :class="{ open: refreshMenu }">▾</text>
            </view>
          </view>
          <view class="refresh-menu" v-if="refreshMenu">
            <view
              class="rm-item"
              v-for="opt in refreshOptions"
              :key="opt.sec"
              :class="{ on: refreshSec === opt.sec }"
              @click="setRefreshSec(opt.sec)"
            >
              <text class="rm-label">{{ opt.label }}</text>
              <text class="rm-tip">{{ opt.tip }}</text>
              <text class="rm-check" v-if="refreshSec === opt.sec">✓</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 连通式线路带（横向滚动，PC 支持拖拽/滚轮）：整条带颜色随方向切换，上行青蓝 / 下行玫红 -->
      <view class="route-strip glass" :class="activeDir === 1 ? 'dir-down' : 'dir-up'" ref="strip">
        <view class="strip-inner">
          <view class="node" v-for="(stop, i) in activeCols" :key="stop.stopId">
            <!-- 车辆浮层（高度自适应单站最多车辆数，保证线路对齐且信息完整） -->
            <view class="node-bus" :style="busZoneStyle">
              <view
                class="bchip"
                :class="b.arrived === '1' ? 'arrived' : 'running'"
                v-for="b in stop.buses"
                :key="b.busId"
              >
                <text class="b-org">{{ b.orgId || '?' }}</text>
                <text class="b-meta">{{ b.time }} · {{ b.gpsSpeed }}km/h</text>
                <text class="b-state">{{ b.arrived === '1' ? '到站' : '行驶' }}</text>
              </view>
            </view>
            <!-- 连续线段 + 站点 -->
            <view class="node-mid">
              <view class="seg" :class="{ first: i === 0, last: i === activeCols.length - 1 }"></view>
              <view
                class="dot"
                :class="{ terminal: isTerminal(i, activeCols.length), busy: stop.buses && stop.buses.length }"
              >
                <text class="dot-no">{{ stop.stopNo }}</text>
              </view>
            </view>
            <!-- 站名 + 换乘 -->
            <view class="node-label">
              <text class="node-name" :style="nameZoneStyle">{{ stop.stopName }}</text>
              <view class="node-tags" v-if="stop.transferInfos && stop.transferInfos.length">
                <text class="ttag" v-for="t in stop.transferInfos" :key="t.subwayLineNo">{{ t.subwayLineNo }}号线</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 地图入口 CTA -->
      <view class="cta" v-if="activeCols.length" @click="goMap">
        <text class="cta-icon">🗺️</text>
        <view class="cta-text">
          <text class="cta-title">查看实时地图</text>
          <text class="cta-sub">{{ onlineCount }} 辆车实时位置与行驶方向</text>
        </view>
        <text class="cta-arrow">›</text>
      </view>
    </view>

    <!-- 时刻表 -->
    <view v-if="currentTab === 'plan'" class="tab-content">
      <!-- 方向切换 -->
      <view class="dir-switch glass-soft">
        <view class="dir-opt up" :class="{ active: activeDir === 0 }" @click="setDir(0)">▲ 上行</view>
        <view class="dir-opt down" :class="{ active: activeDir === 1 }" @click="setDir(1)">▼ 下行</view>
      </view>

      <!-- 方向标题栏 -->
      <view class="plan-head" v-if="planSorted.length">
        <text class="ph-dir" :class="activeDir === 1 ? 'down' : 'up'">{{ activeDir === 0 ? '▲ 上行' : '▼ 下行' }}</text>
        <text class="ph-route">{{ activeBase.startStop || startStopOpt || '起点' }} → {{ activeBase.endStop || endStopOpt || '终点' }}</text>
        <text class="ph-count">共 {{ planSorted.length }} 班</text>
      </view>

      <view class="plan-list" v-if="planSorted.length">
        <view class="plan-item glass" v-for="(p, i) in planSorted" :key="p.busId || i">
          <view class="plan-order">第 {{ i + 1 }} 班</view>
          <view class="plan-time">{{ p.planStartTime || '--' }}</view>
          <view class="plan-org">车辆 {{ p.bus || '--' }}</view>
        </view>
      </view>
      <view class="empty glass" v-else-if="!planLoading">
        <view class="empty-icon">🕐</view>
        <view class="empty-text">暂无{{ activeDir === 0 ? '上行' : '下行' }}计划发车数据</view>
      </view>
    </view>

    <!-- 刷新间隔下拉的“点外部关闭”透明遮罩 -->
    <view class="rm-mask" v-if="refreshMenu" @click="refreshMenu = false"></view>
  </view>
</template>

<script>
import { fetchLine, fetchPlanTime, fetchRealTime, decryptBusId, onBusIdReady } from '../../utils/api.js'
import { matchBusesToStops } from '../../utils/geo.js'
import { buildLineCode } from '../../config.js'

// 自动刷新间隔（秒）：0 = 手动。与地图页各存一份（地图页是 whbis:map-refresh-sec），
// 两页的使用节奏不同，共用反而互相干扰；详情页默认 15 秒（旧行为）。
const LINE_REFRESH_KEY = 'whbis:line-refresh-sec'
const REFRESH_OPTS = [0, 15, 20, 30]

export default {
  data() {
    return {
      lineCode: '',
      lineNo: '',
      direction: 0,
      activeDir: 0,
      lineName: '',
      startStopOpt: '',
      endStopOpt: '',
      // 双方向数据：0=上行，1=下行
      diagram: {
        0: { cols: [], base: {} },
        1: { cols: [], base: {} },
      },
      planTimes: [],
      loading: false,
      planLoading: false,
      lastUpdate: '',
      currentTab: 'stops',
      // 刷新间隔（秒）：0 = 手动；15 / 20 / 30 = 自动
      refreshSec: 15,
      // 刷新间隔下拉是否展开
      refreshMenu: false,
      _timer: null,
    }
  },
  computed: {
    activeBase() {
      return this.diagram[this.activeDir].base || {}
    },
    activeCols() {
      return this.diagram[this.activeDir].cols || []
    },
    onlineCount() {
      return this.activeCols.reduce((n, s) => n + (s.buses ? s.buses.length : 0), 0)
    },
    // 当前方向中，单站最多停靠车辆数（用于计算浮层区高度）
    maxBuses() {
      return this.activeCols.reduce((m, s) => Math.max(m, s.buses ? s.buses.length : 0), 0)
    },
    // 车辆浮层区高度：按最多车辆数自适应（每辆约 108rpx，下限 170rpx，上限 6 辆）
    busZoneStyle() {
      const count = Math.min(this.maxBuses, 6)
      const h = Math.max(170, count * 108 + 24)
      return { height: h + 'rpx' }
    },
    // 当前方向中最长站名的行数（每行约 6 个汉字），用于统一预留高度使换乘标签对齐
    maxNameLines() {
      const perLine = 6
      return this.activeCols.reduce((m, s) => {
        const len = (s.stopName || '').length
        return Math.max(m, Math.ceil(len / perLine) || 1)
      }, 1)
    },
    // 站名区高度：按最长站名行数预留（行高 36rpx），保证标签纵向对齐
    nameZoneStyle() {
      const lines = Math.min(Math.max(this.maxNameLines, 1), 4)
      return { minHeight: lines * 36 + 'rpx' }
    },
    // 刷新控件右半显示的文案（与地图页一致：0 → 手动，其余 → N秒）
    refreshLabel() {
      return this.refreshSec > 0 ? `${this.refreshSec}秒` : '手动'
    },
    refreshTitle() {
      return this.refreshSec > 0 ? `每 ${this.refreshSec} 秒自动刷新` : '手动刷新（点 ↻ 拉取）'
    },
    refreshOptions() {
      return [
        { sec: 0, label: '手动刷新', tip: '点 ↻ 才拉取' },
        { sec: 15, label: '15 秒', tip: '最灵敏' },
        { sec: 20, label: '20 秒', tip: '较灵敏' },
        { sec: 30, label: '30 秒', tip: '省流量' },
      ]
    },
    // 时刻表按计划发车时间升序排列（后端 startOrder 不可靠，班次序号由排序生成）
    planSorted() {
      return [...this.planTimes].sort((a, b) =>
        (a.planStartTime || '').localeCompare(b.planStartTime || '')
      )
    },
    // 所属营运公司：由车辆自编号（orgId）首位数字推断，1 → 武汉公交集团第一营运公司，以此类推
    operatorCompanies() {
      const cn = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']
      const set = new Set()
      const pick = (id) => {
        const d = String(id || '').charAt(0)
        if (d >= '1' && d <= '9') set.add(Number(d))
      }
      // 优先用当前方向在线车辆推断；无在线车辆时退而用时刻表车辆编号
      this.activeCols.forEach((s) => (s.buses || []).forEach((b) => pick(b.orgId)))
      if (!set.size) this.planTimes.forEach((p) => pick(p.bus))
      return [...set]
        .sort((a, b) => a - b)
        .map((no) => ({ no, label: `武汉公交集团${cn[no]}营运公司` }))
    },
  },
  onLoad(options) {
    this.lineCode = options.lineCode || ''
    this.direction = Number(options.direction || 0)
    this.activeDir = this.direction
    this.lineName = options.lineName || this.lineCode.split('-')[1] || ''
    this.lineNo = this.lineCode.split('-')[1] || options.lineName || ''
    this.startStopOpt = options.startStop || ''
    this.endStopOpt = options.endStop || ''
    this.loadAll()
    // 编号字典就绪后重新还原自编号并刷新
    onBusIdReady(() => this.loadLive())
    // 自动刷新的启动/停止交给 onShow / onHide（首次进入也会立即走到），
    // 这样翻开地图页时本页不再后台空拉接口
    this.refreshSec = this.readRefreshSec()
  },
  onShow() {
    this.restartAutoRefresh()
  },
  onHide() {
    this.stopAutoRefresh()
  },
  onUnload() {
    this.stopAutoRefresh()
    if (this._stripCleanup) {
      this._stripCleanup()
      this._stripCleanup = null
    }
  },
  onReady() {
    // #ifdef H5
    this.bindStripScroll()
    // #endif
  },
  methods: {
    switchTab(key) {
      this.currentTab = key
      // 刷新控件只存在于实时线路页，切走时把可能展开的下拉一并收掉（否则遮罩会残留）
      this.refreshMenu = false
      if (key === 'plan') this.loadPlan()
    },
    setDir(dir) {
      if (this.activeDir === dir) return
      this.activeDir = dir
      // 处于时刻表页时，切换方向需重新加载该方向班次
      if (this.currentTab === 'plan') this.loadPlan()
    },
    // 手动刷新实时车辆（点胶囊左半的 ↻）
    async onRefresh() {
      if (this.loading) return
      await this.loadLive()
      uni.showToast({ title: '实时数据已刷新', icon: 'none' })
    },
    // 读上次选择的间隔：未设过或值非法时回落到 15 秒（保持旧有行为）
    // ⚠ uni.getStorageSync 在键不存在时返回空字符串，Number('') === 0，
    // 直接 Number 后再 includes 会把“从没设过”误判成“手动”（0 是合法值），必须先排除空值
    readRefreshSec() {
      try {
        const raw = uni.getStorageSync(LINE_REFRESH_KEY)
        if (raw === '' || raw == null) return 15
        const v = Number(raw)
        return REFRESH_OPTS.includes(v) ? v : 15
      } catch (e) {
        return 15
      }
    },
    // 选择间隔：0 = 手动，其余按秒数轮询（立即生效并持久化）
    setRefreshSec(sec) {
      this.refreshMenu = false
      if (sec === this.refreshSec) {
        // 重复点同一项：把计时器拨回起点（相当于“从现在开始重新计数”）
        this.restartAutoRefresh()
        return
      }
      this.refreshSec = sec
      try {
        uni.setStorageSync(LINE_REFRESH_KEY, sec)
      } catch (e) {
        /* 存储不可用时仅本次生效 */
      }
      this.restartAutoRefresh()
      // 切到自动模式立刻拉一次，不必等满一个间隔才看到变化
      if (sec > 0) this.loadLive(true)
      uni.showToast({ title: sec > 0 ? `已开启：每 ${sec} 秒自动刷新` : '已改为手动刷新', icon: 'none' })
    },
    // 重建自动刷新定时器（间隔改变、页面重新显示时调用；先清旧再建，避免叠多个）
    restartAutoRefresh() {
      this.stopAutoRefresh()
      if (!this.refreshSec) return
      this._timer = setInterval(() => this.loadLive(true), this.refreshSec * 1000)
    },
    stopAutoRefresh() {
      if (this._timer) {
        clearInterval(this._timer)
        this._timer = null
      }
    },
    // 一键复制当前方向在线车辆信息（编号 / 所在站点 / 时间 / 速度 / 状态 / 经纬度），多辆车逐行换行
    copyOnlineBuses() {
      const lines = []
      this.activeCols.forEach((stop) => {
        ;(stop.buses || []).forEach((b) => {
          const state = b.arrived === '1' ? '到站' : '行驶'
          const coord = b.lat != null && b.lng != null ? `${b.lat},${b.lng}` : '--'
          lines.push(
            `${b.orgId || b.busNo || '?'}\t${stop.stopName || '未知站点'}\t${b.time}\t${b.gpsSpeed}km/h\t${state}\t${coord}`
          )
        })
      })
      if (!lines.length) {
        uni.showToast({ title: '当前无在线车辆', icon: 'none' })
        return
      }
      const dirName = this.activeDir === 0 ? '上行' : '下行'
      const header = `${this.lineName || this.lineNo}（${dirName}） 在线 ${lines.length} 辆  ${this.lastUpdate}`
      const cols = '编号\t所在站点\t时间\t速度\t状态\t经纬度'
      const data = `${header}\n${cols}\n${lines.join('\n')}`
      uni.setClipboardData({
        data,
        success: () => uni.showToast({ title: `已复制 ${lines.length} 辆车信息`, icon: 'none' }),
        fail: () => uni.showToast({ title: '复制失败', icon: 'none' }),
      })
    },
    // H5：为线路带绑定鼠标拖拽 + 滚轮横向滚动（PC 端可用）
    bindStripScroll() {
      const r = this.$refs.strip
      const el = r && (r.$el || r)
      if (!el || typeof el.addEventListener !== 'function') return
      let down = false
      let startX = 0
      let startLeft = 0
      const onDown = (e) => {
        down = true
        startX = e.pageX
        startLeft = el.scrollLeft
        el.style.cursor = 'grabbing'
      }
      const onMove = (e) => {
        if (!down) return
        el.scrollLeft = startLeft - (e.pageX - startX)
      }
      const onUp = () => {
        if (!down) return
        down = false
        el.style.cursor = 'grab'
      }
      const onWheel = (e) => {
        // 竖向滚轮转为横向滚动
        if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          el.scrollLeft += e.deltaY
          e.preventDefault()
        }
      }
      el.addEventListener('mousedown', onDown)
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      el.addEventListener('wheel', onWheel, { passive: false })
      this._stripCleanup = () => {
        el.removeEventListener('mousedown', onDown)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        el.removeEventListener('wheel', onWheel)
      }
    },
    isTerminal(i, len) {
      return i === 0 || i === len - 1
    },
    // 加载全部（两个方向站点 + 实时车辆）
    async loadAll() {
      await Promise.all([this.loadDirStops(0), this.loadDirStops(1)])
      await this.loadLive()
    },
    // 加载某方向站点与基础信息
    async loadDirStops(dir) {
      const code = buildLineCode(this.lineNo, dir)
      try {
        const data = await fetchLine(code)
        this.diagram[dir].base = (data && data.lineDetailBaseDto) || {}
        if (data && data.lineDetailBaseDto && dir === this.direction) {
          this.lineName = this.lineName || data.lineDetailBaseDto.lineName
        }
        const stops = (data && data.stopDetailList) || []
        this.diagram[dir].cols = stops.map((s) => ({ ...s, buses: [] }))
      } catch (e) {
        this.diagram[dir].cols = []
        uni.showToast({ title: `线路加载失败：${e.message}`, icon: 'none' })
      }
    },
    // 加载两个方向实时车辆
    async loadLive(silent = false) {
      if (!silent) this.loading = true
      try {
        const [up, down] = await Promise.all([
          this.fetchDirBuses(0),
          this.fetchDirBuses(1),
        ])
        this.diagram[0].cols = up
        this.diagram[1].cols = down
        this.lastUpdate = this.currentTime()
      } catch (e) {
        if (!silent) uni.showToast({ title: `实时数据加载失败：${e.message}`, icon: 'none' })
      } finally {
        if (!silent) this.loading = false
      }
    },
    // 拉取并匹配某方向车辆到站点
    async fetchDirBuses(dir) {
      const code = buildLineCode(this.lineNo, dir)
      let cols = this.diagram[dir].cols
      if (!cols || !cols.length) {
        await this.loadDirStops(dir)
        cols = this.diagram[dir].cols
      }
      const stops = cols.map(({ buses, ...rest }) => rest)
      if (!stops.length) return []
      const data = await fetchRealTime(code)
      const list = (data && data.lineBusDtoList) || []
      const buses = list.map((b) => {
        const lat = parseFloat(b.latitude)
        const lng = parseFloat(b.longitude)
        return {
          busId: b.busId,
          orgId: decryptBusId(b.busId) || '',
          busNo: b.busNo,
          arrived: b.arrived,
          order: b.busOrder,
          gpsSpeed: b.gpsSpeed,
          time: this.formatGpsTime(b.gpsTime),
          lat: isNaN(lat) ? null : lat,
          lng: isNaN(lng) ? null : lng,
        }
      })
      const { stopsWithBuses } = matchBusesToStops(buses, stops)
      return stopsWithBuses
    },
    // 去实时车辆地图页
    goMap() {
      const code = buildLineCode(this.lineNo, this.activeDir)
      uni.navigateTo({
        url: `/pages/map/map?lineCode=${code}&direction=${this.activeDir}&lineName=${this.lineName}`,
      })
    },
    // 加载计划发车（当前方向）
    async loadPlan() {
      this.planLoading = true
      try {
        const dir = this.activeDir
        const data = await fetchPlanTime(buildLineCode(this.lineNo, dir))
        const arr = Array.isArray(data) ? data : []
        this.planTimes = arr.map((p) => ({
          ...p,
          dir,
          bus: p.orgBusId || p.orgBusNo || decryptBusId(p.busId) || '',
        }))
      } catch (e) {
        this.planTimes = []
        uni.showToast({ title: `时刻表加载失败：${e.message}`, icon: 'none' })
      } finally {
        this.planLoading = false
      }
    },
    // 格式化 GPS 时间（yyyyMMddHHmmss -> HH:mm）
    formatGpsTime(t) {
      if (!t || t.length !== 14) return '--'
      return `${t.slice(8, 10)}:${t.slice(10, 12)}`
    },
    currentTime() {
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    },
  },
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 28rpx 32rpx 60rpx;
  box-sizing: border-box;
}
/* 毛玻璃基元 */
.glass {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.05));
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 32rpx;
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.20);
}
.glass-soft {
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
}
/* 头部 */
.hero {
  padding: 30rpx 32rpx;
}
.hero-top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
/* 营运公司徽章 */
.org-tags {
  display: flex;
  flex-wrap: wrap;
  margin-left: auto;
  padding-left: 16rpx;
}
.org-tag {
  display: inline-flex;
  align-items: center;
  background: rgba(251, 191, 36, 0.12);
  border: 2rpx solid rgba(251, 191, 36, 0.35);
  border-radius: 999rpx;
  padding: 4rpx 18rpx 4rpx 4rpx;
  margin: 6rpx 0 6rpx 12rpx;
  white-space: nowrap;
}
.org-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  font-size: 26rpx;
  font-weight: 800;
  color: #1a1205;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  box-shadow: 0 4rpx 12rpx rgba(251, 191, 36, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.4);
  margin-right: 12rpx;
  flex-shrink: 0;
}
.org-name {
  font-size: 20rpx;
  color: #fcd34d;
}
.badge {
  font-size: 42rpx;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border-radius: 20rpx;
  padding: 12rpx 26rpx;
  margin-right: 22rpx;
  box-shadow: 0 10rpx 28rpx rgba(6, 182, 212, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.35);
}
.route {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: #fff;
  font-weight: 600;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  line-height: 1.5;
}
.route-start, .route-end {
  white-space: normal;
  word-break: break-all;
}
.route-arrow {
  margin: 0 14rpx;
  color: #a5b4fc;
}
/* 营运信息 */
.ops {
  display: flex;
  margin-top: 26rpx;
  padding-top: 24rpx;
  border-top: 2rpx solid rgba(255, 255, 255, 0.1);
}
.ops-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}
.ops-value {
  font-size: 32rpx;
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.ops-value.online {
  color: #67e8f9;
}
.ops-label {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 6rpx;
}
/* 在线格子：可点击一键复制 */
.ops-click {
  cursor: pointer;
  padding: 6rpx 0;
  border-radius: 16rpx;
  transition: background 0.2s, transform 0.1s;
}
.ops-click:hover {
  background: rgba(103, 232, 249, 0.12);
}
.ops-click:active {
  transform: scale(0.94);
}
.ops-label.online-label {
  color: #67e8f9;
}
/* Tab 分段控件 */
.tabs {
  display: flex;
  margin-top: 28rpx;
  padding: 8rpx;
  border-radius: 999rpx;
}
.tab {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.6);
  border-radius: 999rpx;
  transition: all 0.22s;
}
.tab:hover {
  color: rgba(255, 255, 255, 0.9);
}
.tab.active {
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 10rpx 24rpx rgba(99, 102, 241, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.35);
}
/* 方向切换 */
.dir-switch {
  display: flex;
  margin: 28rpx 0 8rpx;
  padding: 6rpx;
  border-radius: 999rpx;
}
.dir-opt {
  flex: 1;
  text-align: center;
  padding: 14rpx 0;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.6);
  border-radius: 999rpx;
  transition: all 0.2s;
}
.dir-opt.active {
  color: #062a33;
  font-weight: 700;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
  box-shadow: 0 8rpx 20rpx rgba(6, 182, 212, 0.35), inset 0 1rpx 0 rgba(255, 255, 255, 0.4);
}
/* 下行选中态用玫红，与地图页下行走向线同色 */
.dir-opt.down.active {
  color: #fff;
  background: linear-gradient(135deg, #fda4af, #e11d48);
  box-shadow: 0 8rpx 20rpx rgba(225, 29, 72, 0.38), inset 0 1rpx 0 rgba(255, 255, 255, 0.4);
}
.live-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 8rpx 16rpx;
}
.lt-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.lt-count {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.6);
}
.live-tip .upd {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 4rpx;
}
/* 刷新控件：与地图页同一套设计 —— 左半 ↻ 立即刷一次，右半显示当前间隔并可展开设置 */
.refresh-wrap {
  position: relative;
  flex-shrink: 0;
}
.refresh-pill {
  display: flex;
  align-items: stretch;
  border-radius: 999rpx;
  overflow: hidden;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  box-shadow: 0 10rpx 24rpx rgba(99, 102, 241, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
  transition: box-shadow 0.2s;
}
/* 自动刷新进行中：外圈加一道青色光环，一眼看出“正在自动跑” */
.refresh-pill.auto {
  box-shadow: 0 0 0 3rpx rgba(103, 232, 249, 0.55), 0 10rpx 24rpx rgba(99, 102, 241, 0.42);
}
.refresh-pill.busy .rp-refresh {
  opacity: 0.55;
}
.rp-refresh {
  display: flex;
  align-items: center;
  padding: 12rpx 16rpx 12rpx 24rpx;
  cursor: pointer;
}
.rp-ico {
  font-size: 28rpx;
  line-height: 1;
  color: #fff;
}
.rp-ico.spin {
  animation: rp-spin 0.9s linear infinite;
}
@keyframes rp-spin {
  to {
    transform: rotate(360deg);
  }
}
.rp-split {
  width: 2rpx;
  margin: 14rpx 0;
  background: rgba(255, 255, 255, 0.38);
}
.rp-mode {
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 12rpx 22rpx 12rpx 16rpx;
  cursor: pointer;
}
.rp-txt {
  font-size: 24rpx;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.rp-caret {
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.88);
  transition: transform 0.2s;
}
.rp-caret.open {
  transform: rotate(180deg);
}
/* 间隔下拉：按钮贴在行尾，右对齐向左展开，否则会顶出页面右边界 */
.refresh-menu {
  position: absolute;
  top: calc(100% + 14rpx);
  right: 0;
  z-index: 30;
  width: 310rpx;
  padding: 10rpx;
  background: rgba(17, 24, 44, 0.96);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 22rpx;
  box-shadow: 0 18rpx 44rpx rgba(0, 0, 0, 0.5);
}
.rm-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx;
  border-radius: 16rpx;
  cursor: pointer;
}
.rm-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.rm-item.on {
  background: rgba(6, 182, 212, 0.22);
}
.rm-label {
  font-size: 24rpx;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
}
.rm-tip {
  flex: 1;
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.42);
  text-align: right;
  white-space: nowrap;
}
.rm-check {
  font-size: 22rpx;
  color: #67e8f9;
}
/* 下拉的“点外部关闭”透明遮罩：压在菜单之下、其余内容之上 */
.rm-mask {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 29;
}
/* 连通式线路带 */
.route-strip {
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  cursor: grab;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
/* 方向色变量：与地图页 DIR_STYLE 同源 —— 上行青蓝 / 下行玫红 */
.dir-up {
  --line-a: #06b6d4;
  --line-b: #22d3ee;
  --ring: #67e8f9;
  --num: #a5f3fc;
  --glow: rgba(34, 211, 238, 0.22);
}
.dir-down {
  --line-a: #e11d48;
  --line-b: #fb7185;
  --ring: #fda4af;
  --num: #fecdd3;
  --glow: rgba(251, 113, 133, 0.22);
}
.route-strip::-webkit-scrollbar {
  display: none;
}
.strip-inner {
  display: inline-flex;
  flex-direction: row;
  align-items: flex-start;
  padding: 28rpx 32rpx 32rpx;
}
.node {
  flex-shrink: 0;
  width: 180rpx;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
}
/* 车辆浮层（高度由内联 busZoneStyle 动态控制，保证线路对齐） */
.node-bus {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
}
/* 连续线段 + 站点 */
.node-mid {
  position: relative;
  width: 100%;
  height: 40rpx;
}
.seg {
  position: absolute;
  left: 0;
  right: 0;
  top: 17rpx;
  height: 6rpx;
  background: #06b6d4; /* 不支持 CSS 变量时的兜底 */
  background: linear-gradient(90deg, var(--line-a), var(--line-b));
  border-radius: 3rpx;
}
.seg.first { left: 50%; }
.seg.last { right: 50%; }
.dot {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #0b1020;
  border: 4rpx solid #a5b4fc; /* 兜底 */
  border-color: var(--ring);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.dot-no {
  font-size: 18rpx;
  font-weight: 700;
  color: #c7d2fe;
  color: var(--num);
}
/* 首末站：实心方向色 + 白环，与地图页站点标记一致 */
.dot.terminal {
  background: #22d3ee;
  background: var(--line-b);
  border-color: #ffffff;
}
.dot.terminal .dot-no {
  color: #0b1020;
}
/* 有车的站：白环 + 方向色光晕 */
.dot.busy {
  border-color: #ffffff;
  box-shadow: 0 0 0 6rpx rgba(103, 232, 249, 0.22);
  box-shadow: 0 0 0 6rpx var(--glow);
}
/* 站名 + 换乘 */
.node-label {
  margin-top: 20rpx;
  width: 168rpx;
  text-align: center;
}
.node-name {
  display: block;
  font-size: 24rpx;
  color: #fff;
  line-height: 1.5;
  letter-spacing: 1rpx;
  white-space: normal;
  word-break: break-all;
  /* 高度由内联 nameZoneStyle 按最长站名行数动态预留，使换乘标签纵向对齐 */
}
.node-tags {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 10rpx;
}
.ttag {
  display: block;
  font-size: 18rpx;
  /* 地铁换乘标签用紫色，避开与上行（青蓝）/ 下行（玫红）方向色撞色 */
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.16);
  border: 2rpx solid rgba(139, 92, 246, 0.3);
  border-radius: 8rpx;
  padding: 2rpx 12rpx;
  margin-bottom: 6rpx;
  white-space: nowrap;
}
.ttag:last-child {
  margin-bottom: 0;
}
/* 车辆胶囊 */
.bchip {
  min-width: 130rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  padding: 8rpx 12rpx;
  margin-bottom: 10rpx;
  text-align: center;
  background: rgba(11, 16, 32, 0.72);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
}
.bchip.arrived {
  border-color: rgba(52, 211, 153, 0.55);
  background: rgba(52, 211, 153, 0.16);
}
.bchip.running {
  border-color: rgba(251, 191, 36, 0.55);
  background: rgba(251, 191, 36, 0.16);
}
.b-org {
  display: block;
  font-size: 26rpx;
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.b-meta {
  display: block;
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.78);
  margin-top: 4rpx;
  font-variant-numeric: tabular-nums;
}
.b-state {
  display: block;
  font-size: 17rpx;
  color: rgba(255, 255, 255, 0.58);
  margin-top: 3rpx;
}
/* 地图 CTA */
.cta {
  display: flex;
  align-items: center;
  margin-top: 32rpx;
  padding: 30rpx 34rpx;
  border-radius: 28rpx;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.92), rgba(6, 182, 212, 0.92));
  box-shadow: 0 18rpx 46rpx rgba(6, 182, 212, 0.4), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
  transition: transform 0.2s, box-shadow 0.2s;
}
.cta:hover {
  transform: translateY(-4rpx);
  box-shadow: 0 26rpx 60rpx rgba(6, 182, 212, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.cta:active {
  transform: translateY(-1rpx) scale(0.995);
}
.cta-icon {
  font-size: 44rpx;
  margin-right: 22rpx;
}
.cta-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.cta-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #fff;
}
.cta-sub {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 6rpx;
}
.cta-arrow {
  font-size: 40rpx;
  color: #fff;
  width: 60rpx;
  height: 60rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  transition: transform 0.2s;
}
.cta:hover .cta-arrow {
  transform: translateX(4rpx);
}
/* 时刻表 */
.tab-content {
  padding-top: 28rpx;
}
/* 方向标题栏 */
.plan-head {
  display: flex;
  align-items: center;
  padding: 18rpx 24rpx;
  margin-top: 20rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
}
.ph-dir {
  font-size: 24rpx;
  font-weight: 700;
  padding: 4rpx 16rpx;
  border-radius: 10rpx;
  margin-right: 16rpx;
  flex-shrink: 0;
}
.ph-dir.up {
  color: #67e8f9;
  background: rgba(6, 182, 212, 0.16);
  border: 2rpx solid rgba(6, 182, 212, 0.3);
}
.ph-dir.down {
  color: #fda4af;
  background: rgba(225, 29, 72, 0.18);
  border: 2rpx solid rgba(251, 113, 133, 0.32);
}
.ph-route {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.85);
  white-space: normal;
  word-break: break-all;
  line-height: 1.4;
}
.ph-count {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.5);
  margin-left: 16rpx;
  flex-shrink: 0;
}
.plan-item {
  display: flex;
  align-items: center;
  padding: 28rpx;
  margin-bottom: 20rpx;
}
.plan-order {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.55);
  width: 130rpx;
}
.plan-time {
  font-size: 38rpx;
  font-weight: 800;
  color: #a5b4fc;
  flex: 1;
  font-variant-numeric: tabular-nums;
}
.plan-org {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.6);
}
/* 空状态 */
.empty {
  margin-top: 40rpx;
  padding: 70rpx 40rpx;
  text-align: center;
}
.empty-icon {
  font-size: 80rpx;
}
.empty-text {
  color: rgba(255, 255, 255, 0.6);
  font-size: 28rpx;
  margin-top: 20rpx;
}
</style>
