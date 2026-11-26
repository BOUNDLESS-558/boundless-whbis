<template>
  <!-- 数据面板：按日营运档案。优先读 Vercel 按日表 API，失败回退静态 profile.json -->
  <view class="dp-body">
    <!-- 顶部：数据时次 + 导出 / 同步 -->
    <view class="dp-actions">
      <text class="dp-stamp">{{ stamp ? stamp + ' · ' + filteredCount + ' 辆' : '尚未同步 · 0 辆' }}</text>
      <view class="dp-ops">
        <CopyPill label="导出" :disabled="!filteredCount" @copy="onCopy" />
        <view class="dp-mini" :title="loading ? '同步中' : '同步最新数据'" @click="onSync">{{ loading ? '⏳ 同步中' : '🔄 同步' }}</view>
      </view>
    </view>

    <!-- 筛选条：常驻一行，点击整条展开/折叠；窄屏默认折叠，让数据先露出来 -->
    <view class="dp-filter-bar">
      <view class="dp-filter-toggle" @click="filtersOpen = !filtersOpen">
        <text class="dp-ft-ico">🔍</text>
        <text class="dp-ft-label">筛选</text>
        <text class="dp-ft-sum">{{ filterSummary }}</text>
        <text class="dp-ft-arrow">{{ filtersOpen ? '▴' : '▾' }}</text>
      </view>
      <view class="dp-filter-reset" :class="{ off: !hasFilter }" @click="resetFilters">↺ 重置</view>
    </view>

    <!-- 筛选面板：四组可独立折叠，收起时表头显示当前值 -->
    <view class="dp-filter-panel" v-if="filtersOpen">
      <view class="dp-fgroup">
        <view class="dp-fg-head" @click="toggleGroup('date')">
          <text>📅 年 / 月</text>
          <text class="dp-fg-val">{{ dateSummary }}</text>
          <text class="dp-fg-arrow">{{ openGroups.date ? '▴' : '▾' }}</text>
        </view>
        <view class="dp-fg-body" v-if="openGroups.date">
          <view class="dp-chips">
            <view v-for="y in yearOpts" :key="'y' + y" class="dp-chip" :class="{ on: fy === y }" @click="pickYear(y)">{{ y === '全部' ? '全部年' : y }}</view>
            <view v-for="m in monthOpts" :key="'m' + m" class="dp-chip" :class="{ on: fm === m }" @click="pickMonth(m)">{{ m === '全部' ? '全部月' : m + '月' }}</view>
          </view>
        </view>
      </view>

      <view class="dp-fgroup">
        <view class="dp-fg-head" @click="toggleGroup('day')">
          <text>🗓 具体日</text>
          <text class="dp-fg-val">{{ fd === ALL ? '全部日' : fd }}</text>
          <text class="dp-fg-arrow">{{ openGroups.day ? '▴' : '▾' }}</text>
        </view>
        <view class="dp-fg-body" v-if="openGroups.day">
          <view class="dp-chips">
            <view v-for="d in dayOpts" :key="'d' + d" class="dp-chip" :class="{ on: fd === d }" @click="pickDay(d)">{{ d === '全部' ? '全部日' : d }}</view>
          </view>
        </view>
      </view>

      <view class="dp-fgroup">
        <view class="dp-fg-head" @click="toggleGroup('company')">
          <text>🏢 营运公司</text>
          <text class="dp-fg-val">{{ fc === ALL ? '全部公司' : shortCompany(fc) }}</text>
          <text class="dp-fg-arrow">{{ openGroups.company ? '▴' : '▾' }}</text>
        </view>
        <view class="dp-fg-body" v-if="openGroups.company">
          <view class="dp-chips">
            <view v-for="c in companyOpts" :key="'c' + c" class="dp-chip" :class="{ on: fc === c }" :title="c" @click="pickCompany(c)">{{ c === '全部' ? '全部公司' : shortCompany(c) }}</view>
          </view>
        </view>
      </view>

      <view class="dp-fgroup">
        <view class="dp-fg-head" @click="toggleGroup('line')">
          <text>🚌 线路</text>
          <text class="dp-fg-val">{{ fl === ALL ? '全部线路' : fl + ' 路' }}</text>
          <text class="dp-fg-arrow">{{ openGroups.line ? '▴' : '▾' }}</text>
        </view>
        <view class="dp-fg-body" v-if="openGroups.line">
          <view class="dp-chips">
            <view v-for="l in lineOpts" :key="'l' + l" class="dp-chip" :class="{ on: fl === l }" @click="pickLine(l)">{{ l === '全部' ? '全部线路' : l }}</view>
          </view>
        </view>
      </view>
    </view>

    <!-- 搜索 + 排序（排序横向滚动，不占多行） -->
    <view class="dp-toolbar">
      <input
        class="dp-search"
        v-model="keyword"
        type="text"
        placeholder="筛选自编号 / 线路号 / 公司"
        placeholder-class="dp-search-ph"
        confirm-type="search"
      />
      <scroll-view class="dp-sorts" scroll-x>
        <view class="dp-sorts-inner">
          <view
            v-for="s in sortOptions"
            :key="s.key"
            class="dp-sort"
            :class="{ on: sortKey === s.key }"
            @click="onSort(s.key)"
          >{{ s.label }}<text v-if="sortKey === s.key" class="dp-sort-arrow">{{ desc ? '↓' : '↑' }}</text></view>
        </view>
      </scroll-view>
    </view>

    <view class="dp-empty" v-if="!rows.length">
      <text class="dp-empty-big">📂</text>
      <text class="dp-empty-txt">暂无符合条件的营运数据。可点「🔄 同步」读取最新数据。</text>
    </view>

    <!-- 数据行：一行概览 + 点按展开详情，PC / 移动端同一套结构，靠 flex-wrap 自适应 -->
    <scroll-view class="dp-list" scroll-y v-else>
      <view class="dp-item" v-for="r in rows" :key="rowKey(r)">
        <view class="dp-item-head" @click="toggleRow(r)">
          <view class="dp-cell company dp-org">
            <view class="org-tag" :class="{ foreign: rowBadges[rowKey(r)].foreign }" :title="rowBadges[rowKey(r)].label">
              <image v-if="rowBadges[rowKey(r)].foreign" class="org-logo" :src="rowBadges[rowKey(r)].logo" mode="aspectFit" />
              <text v-else class="org-no">{{ rowBadges[rowKey(r)].no }}</text>
              <text class="org-name">{{ rowBadges[rowKey(r)].short }}</text>
            </view>
          </view>
          <text class="dp-cell line" :title="'历史线路：' + (r.lines || []).join(' / ')">{{ r.lineNo || (r.lines || [])[0] || '—' }}</text>
          <text class="dp-cell org" :title="r.orgId">{{ fmtNo(r.orgId) }}</text>
          <text class="dp-cell record">{{ recordText(r) }}</text>
          <text class="dp-cell speed" :style="{ color: speedColor(r.maxSpeed) }">{{ r.maxSpeed }}<text class="dp-unit">km/h</text></text>
          <text class="dp-cell over">
            <text class="dp-badge" :style="speedStyle(r.maxSpeed)">⚡ {{ r.speedCount }}</text>
            <text class="dp-driver-tag" :style="tierStyle(r)">{{ tierOf(r).emoji }} {{ tierOf(r).label }}</text>
          </text>
          <text class="dp-cell arrow">{{ expanded[rowKey(r)] ? '▴' : '▾' }}</text>
        </view>
        <view class="dp-item-detail" v-if="expanded[rowKey(r)]">
          <view class="dp-dcell"><text class="dp-dk">记录时间</text><text class="dp-dv">{{ recordText(r) }}</text></view>
          <view class="dp-dcell"><text class="dp-dk">首次上线</text><text class="dp-dv">{{ r.onlineAt || '—' }}</text></view>
          <view class="dp-dcell"><text class="dp-dk">最终下线</text><text class="dp-dv">{{ r.offlineAt || '—' }}</text></view>
          <view class="dp-dcell"><text class="dp-dk">发车 / 超速</text><text class="dp-dv">{{ r.departures }} 次 / {{ r.speedCount }} 次</text></view>
          <view class="dp-dcell"><text class="dp-dk">超速评价</text><text class="dp-dv" :style="{ color: tierOf(r).color }">{{ tierOf(r).emoji }} {{ tierOf(r).label }}</text></view>
          <view class="dp-dcell full"><text class="dp-dk">车辆调配</text><text class="dp-dv">{{ transferText(r) }}</text></view>
        </view>
      </view>
    </scroll-view>

    <!-- 分页：上行统计/每页/跳页，下行翻页按钮+可横滑页码 -->
    <view class="dp-pager" v-if="pageCount > 1">
      <view class="dp-pg-top">
        <text class="dp-pg-info">共 {{ filteredCount }} 条 · 第 {{ page }} / {{ pageCount }} 页</text>
        <view class="dp-pg-size">
          <text>每页</text>
          <view v-for="n in pageSizeOpts" :key="n" class="dp-pg-size-opt" :class="{ on: pageSize === n }" @click="setSize(n)">{{ n }}</view>
        </view>
        <view class="dp-pg-jump">跳至<input class="dp-pg-jump-input" type="number" v-model="jumpPage" @confirm="doJump" />页</view>
      </view>
      <view class="dp-pg-nav">
        <view class="dp-pg-arrow" :class="{ dis: page <= 1 }" @click="gotoPage(page - 1)">⬅️ 上一页</view>
        <scroll-view class="dp-pg-nums" scroll-x>
          <view class="dp-pg-nums-inner">
            <view v-for="(p, i) in pageList" :key="i" class="dp-pg-num" :class="{ on: p === page, gap: p === '…' }" @click="gotoPage(p)">{{ p }}</view>
          </view>
        </scroll-view>
        <view class="dp-pg-arrow" :class="{ dis: page >= pageCount }" @click="gotoPage(page + 1)">下一页 ➡️</view>
      </view>
    </view>

    <view class="dp-foot">
      <text>超速阈值 {{ speedLimit }} km/h · 数据来源：{{ apiMode ? 'Vercel 数据库（按日）' : '项目内静态快照（累计）' }}</text>
    </view>
  </view>
</template>

<script>
import { copyTable } from '../utils/clipboard.js'
import { formatBusNo } from '../utils/busNumber.js'
import { APP_CONFIG } from '../config.js'
import { assetUrl } from '../utils/asset.js'
import { SPEED_BANDS, speedBandOf } from '../utils/cityBus.js'
import { companyOf } from '../utils/companies.js'
import { PAGE_SIZE_OPTS, getPageSize, setPageSize, pageCount as calcPageCount, pageList as calcPageList, clampPage } from '../utils/pagination.js'
import CopyPill from './CopyPill.vue'

const PROFILE_URL = 'static/vehicle-ops/profile.json'
const ALL = '全部'

const CN_ORG = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']
// 超速次数档位标签：与实时车辆面板的分档色独立，按「累计超速次数」评价驾驶风格
const DRIVER_TIERS = [
  { max: 0, label: '守规标兵', emoji: '😌', color: '#7f8aa3' },
  { max: 2, label: '偶尔飘一下', emoji: '🙂', color: '#38bdf8' },
  { max: 5, label: '有点上头', emoji: '😏', color: '#60a5fa' },
  { max: 10, label: '风驰电掣', emoji: '😎', color: '#a78bfa' },
  { max: 20, label: '秋名山车神', emoji: '🔥', color: '#fb923c' },
  { max: 49, label: '狂飙选手', emoji: '⚡', color: '#f87171' },
  { max: Infinity, label: '暴躁车神', emoji: '😱', color: '#ef4444' },
]
function driverTierOf(n) {
  const v = Math.max(0, Number(n) || 0)
  return DRIVER_TIERS.find((t) => v <= t.max) || DRIVER_TIERS[DRIVER_TIERS.length - 1]
}

const SORTS = [
  { key: 'lineNo', label: '线路号' },
  { key: 'orgId', label: '自编号' },
  { key: 'recordedAt', label: '记录时间' },
  { key: 'maxSpeed', label: '车速' },
  { key: 'speedCount', label: '超速' },
  { key: 'departures', label: '发车' },
  { key: 'onlineAt', label: '上线' },
  { key: 'offlineAt', label: '下线' },
]

function normalize(r, daily = false) {
  return {
    orgId: r.orgId, lineNo: r.lineNo, company: r.company,
    maxSpeed: Number(r.maxSpeed) || 0, speedCount: Number(r.speedCount) || 0,
    onlineAt: r.onlineAt || '', offlineAt: r.offlineAt || '',
    departures: Number(r.departures) || 0, transfers: r.transfers || [], lines: r.lines || [],
    samples: Number(r.samples) || 0,
    date: daily ? (r.date || '') : '', recordedAt: daily ? (r.recordedAt || '') : '',
  }
}

export default {
  name: 'DataPanel',
  components: { CopyPill },
  data() {
    return {
      all: [],          // API：当前页；静态：全部
      localAll: [],     // 静态兜底的全量行
      apiMode: false,
      stamp: '',
      speedLimit: 60,
      loading: false,
      keyword: '',
      fy: ALL, fm: ALL, fd: ALL, fc: ALL, fl: ALL,
      yearOpts: [ALL], monthOpts: [ALL, '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
      dayOpts: [ALL], companyOpts: [ALL], lineOpts: [ALL], allDays: [],
      sortKey: 'maxSpeed', desc: true, sortOptions: SORTS,
      total: 0, page: 1, pageSize: getPageSize(), pageSizeOpts: PAGE_SIZE_OPTS,
      // 折叠态
      filtersOpen: false,
      openGroups: { date: true, day: false, company: false, line: false },
      expanded: {},
      jumpPage: '',
      _bulk: false,
    }
  },
  computed: {
    rows() {
      if (this.apiMode) return this.sortRows(this.all)
      return this.sortRows(this.localFiltered).slice((this.page - 1) * this.pageSize, this.page * this.pageSize)
    },
    localFiltered() {
      const kw = this.keyword.trim().toLowerCase()
      return this.localAll.filter((r) => {
        if (this.fd !== ALL && r.date !== this.fd) return false
        if (this.fd === ALL && this.fy !== ALL && String(r.date).slice(0, 4) !== this.fy) return false
        if (this.fd === ALL && this.fm !== ALL && String(r.date).slice(5, 7) !== this.fm) return false
        if (this.fc !== ALL && r.company !== this.fc) return false
        if (this.fl !== ALL && r.lineNo !== this.fl && !(r.lines || []).includes(this.fl)) return false
        if (!kw) return true
        return String(r.orgId).includes(kw) || String(r.lineNo || '').includes(kw) ||
          (r.lines || []).some((l) => String(l).includes(kw)) || String(r.company || '').toLowerCase().includes(kw)
      })
    },
    filteredCount() { return this.apiMode ? this.total : this.localFiltered.length },
    pageCount() { return calcPageCount(this.filteredCount, this.pageSize) },
    pageList() { return calcPageList(this.pageCount, this.page) },
    hasFilter() {
      return this.fy !== ALL || this.fm !== ALL || this.fd !== ALL || this.fc !== ALL || this.fl !== ALL || !!this.keyword
    },
    dateSummary() {
      if (this.fy !== ALL && this.fm !== ALL) return this.fy + '年' + Number(this.fm) + '月'
      if (this.fy !== ALL) return this.fy + '年'
      if (this.fm !== ALL) return Number(this.fm) + '月'
      return '全部日期'
    },
    filterSummary() {
      const bits = []
      if (this.fd !== ALL) bits.push(this.fd)
      else {
        if (this.fy !== ALL) bits.push(this.fy + '年')
        if (this.fm !== ALL) bits.push(Number(this.fm) + '月')
      }
      if (this.fc !== ALL) bits.push(this.shortCompany(this.fc))
      if (this.fl !== ALL) bits.push(this.fl + '路')
      return bits.length ? bits.join(' · ') : '全部数据'
    },
    // 当前页每行的公司徽标（与实时车辆面板同款：圆形序号 + 短名 / 非集团用公司自己的标）
    rowBadges() {
      const m = {}
      for (const r of this.rows) {
        const d = String(r.orgId || '').charAt(0)
        if (d >= '1' && d <= '9') {
          const no = Number(d)
          m[this.rowKey(r)] = { no, short: CN_ORG[no].replace(/^第/, '') + '公司', label: `武汉公交集团${CN_ORG[no]}营运公司`, foreign: false, logo: '' }
        } else {
          const c = companyOf({ no: r.lineNo, company: r.company })
          m[this.rowKey(r)] = { no: '', short: c.label, label: c.full, foreign: c.key !== 'JT', logo: assetUrl(c.logo) }
        }
      }
      return m
    },
  },
  watch: {
    keyword() { if (this._bulk) return; this.page = 1; if (this.apiMode) this.load() },
    fy() { if (this._bulk) return; this.rebuildDayOpts(); this.page = 1; this.load() },
    fm() { if (this._bulk) return; this.rebuildDayOpts(); this.page = 1; this.load() },
    fd() { if (this._bulk) return; this.page = 1; this.load() },
    fc() { if (this._bulk) return; this.page = 1; this.load() },
    fl() { if (this._bulk) return; this.page = 1; this.load() },
    page() { if (this.apiMode) this.load() },
    pageSize() { this.page = 1; if (this.apiMode) this.load() },
  },
  mounted() { this.load() },
  methods: {
    fmtNo(v) { return formatBusNo(v) },
    shortCompany(c) {
      const s = String(c || '')
      if (s.includes('蔡城')) return '蔡城'
      if (s.includes('木兰')) return '木兰'
      if (s.includes('汉奇')) return '汉奇'
      const m = s.match(/第([一二三四五六七八九])营运公司/)
      return m ? `第${m[1]}公司` : (s || '—')
    },
    shortTime(t) { return String(t || '—').slice(5) },
    recordText(r) { return r.date ? `${r.date} ${r.recordedAt || ''}`.trim() : (r.recordedAt || '—') },
    transferText(r) {
      return (r.transfers || []).map((t) => `${t.from}→${t.to} ${t.at}`).join('\n') || '无调配'
    },
    speedColor(v) { return SPEED_BANDS[speedBandOf(v)].color },
    speedStyle(v) {
      const c = this.speedColor(v)
      return { color: v > this.speedLimit ? '#fff' : c, background: v > this.speedLimit ? c : 'rgba(120,160,220,0.12)' }
    },
    tierOf(r) { return driverTierOf(r.speedCount) },
    tierStyle(r) {
      const t = this.tierOf(r)
      return { color: t.color, borderColor: t.color + '66', background: t.color + '1f' }
    },

    // 折叠交互
    toggleGroup(k) { this.openGroups = { ...this.openGroups, [k]: !this.openGroups[k] } },
    rowKey(r) { return (r.date || '') + '|' + r.orgId },
    toggleRow(r) {
      const k = this.rowKey(r)
      this.expanded = { ...this.expanded, [k]: !this.expanded[k] }
    },
    resetFilters() {
      this._bulk = true
      this.fy = this.fm = this.fd = this.fc = this.fl = ALL
      this.keyword = ''
      this._bulk = false
      this.page = 1
      this.rebuildDayOpts()
      this.load()
    },

    queryParams(extra = {}) {
      const q = {
        view: 'daily', page: this.page, pageSize: this.pageSize,
        keyword: this.keyword.trim(),
        ...extra,
      }
      if (this.fd !== ALL) q.date = this.fd
      else {
        if (this.fy !== ALL) q.year = this.fy
        if (this.fm !== ALL) q.month = this.fm
      }
      if (this.fc !== ALL) q.company = this.fc
      if (this.fl !== ALL) q.line = this.fl
      return q
    },
    load() {
      const api = APP_CONFIG.vehicleOpsApi
      const tryStatic = () => {
        this.apiMode = false
        fetch(assetUrl(PROFILE_URL), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((j) => {
            this.localAll = Object.values(j.buses || {}).map((b) => normalize(b))
            this.stamp = j.updated || ''
            this.speedLimit = j.speedLimit || 60
            this.allDays = j.days || []
            this.rebuildOptions(this.allDays, [], [])
          })
          .catch((e) => console.warn('[DataPanel] 静态读取失败', e))
      }
      if (!api) return tryStatic()
      const q = this.queryParams()
      const qs = Object.keys(q).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join('&')
      fetch(`${api}?${qs}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((j) => {
          if (!Array.isArray(j.rows)) return tryStatic()
          this.apiMode = true
          this.all = j.rows.map((r) => normalize(r, true))
          this.total = Number(j.total) || this.all.length
          this.stamp = j.updated || ''
          this.allDays = j.days || []
          this.rebuildOptions(this.allDays, j.companies || [], j.lines || [])
        })
        .catch((e) => {
          console.warn('[DataPanel] API 读取失败，回退静态资产', e)
          tryStatic()
        })
    },
    rebuildOptions(days, companies, lines) {
      const years = [...new Set(days.map((d) => String(d).slice(0, 4)))].sort().reverse()
      this.yearOpts = [ALL, ...years]
      this.companyOpts = [ALL, ...companies]
      this.lineOpts = [ALL, ...lines]
      this.rebuildDayOpts()
    },
    rebuildDayOpts() {
      let list = this.allDays
      if (this.fy !== ALL) list = list.filter((d) => String(d).startsWith(this.fy + '-'))
      if (this.fm !== ALL) list = list.filter((d) => String(d).slice(5, 7) === this.fm)
      this.dayOpts = [ALL, ...list]
      if (!this.dayOpts.includes(this.fd)) this.fd = ALL
      if (!this.companyOpts.includes(this.fc)) this.fc = ALL
      if (!this.lineOpts.includes(this.fl)) this.fl = ALL
    },
    pickYear(v) { this.fy = v; this.fd = ALL },
    pickMonth(v) { this.fm = v; this.fd = ALL },
    pickDay(v) { this.fd = v },
    pickCompany(v) { this.fc = v },
    pickLine(v) { this.fl = v },
    onSync() {
      this.loading = true
      this.load()
      setTimeout(() => {
        this.loading = false
        uni.showToast({ title: '🔄 已同步', icon: 'none' })
      }, 400)
    },
    onSort(key) {
      if (this.sortKey === key) this.desc = !this.desc
      else { this.sortKey = key; this.desc = true }
    },
    sortRows(list) {
      const key = this.sortKey
      const dir = this.desc ? -1 : 1
      return [...list].sort((a, b) => {
        const av = a[key] || '', bv = b[key] || ''
        if (key === 'lineNo' || key === 'orgId') return ((Number(av) || 0) - (Number(bv) || 0)) * dir
        if (key === 'recordedAt') return String((a.date || '') + av).localeCompare(String((b.date || '') + bv)) * dir
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
        return String(av).localeCompare(String(bv)) * dir
      })
    },
    exportRows(r) {
      return [
        r.company || '', r.lineNo || (r.lines || [])[0] || '', this.fmtNo(r.orgId),
        this.recordText(r), r.onlineAt || '', r.offlineAt || '', String(r.maxSpeed),
        String(r.speedCount), String(r.departures), this.transferText(r).replace(/\n/g, '; '),
      ]
    },
    async onCopy() {
      const columns = ['所属营运公司', '营运线路号', '自编号', '记录时间', '首次上线时间', '最终下线时间', '最高车速', '超速次数', '历史发车次数', '车辆调配记录']
      let list = []
      if (this.apiMode) {
        const q = this.queryParams({ all: '1' })
        delete q.page; delete q.pageSize
        const qs = Object.keys(q).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join('&')
        try {
          const res = await fetch(`${APP_CONFIG.vehicleOpsApi}?${qs}`, { cache: 'no-store' })
          const j = await res.json()
          list = (j.rows || []).map((r) => normalize(r, true))
        } catch (e) { console.warn('[DataPanel] 导出全量失败，回退当前页', e) }
      }
      if (!list.length) list = this.apiMode ? this.all : this.localFiltered
      const rows = this.sortRows(list).map((r) => this.exportRows(r))
      const scope = this.fd !== ALL ? this.fd : (this.fc !== ALL ? this.fc : (this.fl !== ALL ? this.fl + ' 路' : '全部数据'))
      copyTable({ title: `武汉公交营运数据 ${scope} ${this.stamp}`, columns, rows })
    },
    gotoPage(p) {
      const target = clampPage(p, this.pageCount)
      if (target === this.page) return
      this.page = target
      this.jumpPage = ''
    },
    doJump() {
      const n = Number(this.jumpPage)
      if (!n) return
      this.gotoPage(n)
    },
    setSize(n) { this.pageSize = setPageSize(n); this.page = 1 },
  },
}
</script>

<style scoped>
.dp-body { width: 100%; color: #e8edf6; }
/* 顶部 */
.dp-actions { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; padding: 4rpx 0 12rpx; }
.dp-stamp { font-size: 19rpx; color: #9aa6bd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-ops { display: flex; align-items: center; gap: 12rpx; flex: 0 0 auto; }
.dp-mini { padding: 8rpx 16rpx; border-radius: 12rpx; background: rgba(120,160,220,0.12); color: #e8edf6; font-size: 20rpx; cursor: pointer; white-space: nowrap; }

/* 筛选条 */
.dp-filter-bar { display: flex; align-items: center; gap: 10rpx; margin-bottom: 10rpx; }
.dp-filter-toggle { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10rpx; padding: 12rpx 16rpx; border-radius: 14rpx; background: rgba(120,160,220,0.1); cursor: pointer; }
.dp-ft-ico { font-size: 22rpx; }
.dp-ft-label { font-size: 22rpx; font-weight: 700; flex: 0 0 auto; }
.dp-ft-sum { flex: 1 1 auto; min-width: 0; font-size: 19rpx; color: #9aa6bd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-ft-arrow { font-size: 20rpx; color: #9aa6bd; flex: 0 0 auto; }
.dp-filter-reset { flex: 0 0 auto; padding: 12rpx 16rpx; border-radius: 14rpx; background: rgba(var(--ac-rgb), 0.18); color: var(--ac-hi); font-size: 20rpx; cursor: pointer; white-space: nowrap; }
.dp-filter-reset.off { opacity: 0.4; }

/* 筛选面板：四组折叠 */
.dp-filter-panel { display: flex; flex-direction: column; gap: 8rpx; margin-bottom: 12rpx; }
.dp-fgroup { border-radius: 14rpx; background: rgba(120,160,220,0.06); overflow: hidden; }
.dp-fg-head { display: flex; align-items: center; gap: 10rpx; padding: 12rpx 16rpx; font-size: 21rpx; cursor: pointer; }
.dp-fg-val { flex: 1 1 auto; min-width: 0; text-align: right; font-size: 19rpx; color: #9aa6bd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-fg-arrow { flex: 0 0 auto; font-size: 18rpx; color: #9aa6bd; }
.dp-fg-body { padding: 0 16rpx 14rpx; }
.dp-chips { display: flex; flex-wrap: wrap; gap: 8rpx; max-height: 240rpx; overflow-y: auto; }
.dp-chip { padding: 6rpx 14rpx; border-radius: 999rpx; background: rgba(120,160,220,0.1); font-size: 20rpx; color: #9aa6bd; cursor: pointer; white-space: nowrap; }
.dp-chip.on { background: var(--ac, #6366f1); color: #fff; }

/* 搜索 + 排序 */
.dp-toolbar { display: flex; flex-direction: column; gap: 10rpx; margin-bottom: 12rpx; }
.dp-search { width: 100%; box-sizing: border-box; height: 68rpx; line-height: 68rpx; padding: 0 18rpx; border-radius: 12rpx; background: rgba(120,160,220,0.08); color: #e8edf6; font-size: 24rpx; }
.dp-search-ph { color: rgba(232, 237, 246, 0.45); font-size: 24rpx; line-height: 68rpx; }
.dp-sorts { width: 100%; white-space: nowrap; }
.dp-sorts-inner { display: inline-flex; gap: 10rpx; }
.dp-sort { display: inline-block; padding: 8rpx 18rpx; border-radius: 999rpx; background: rgba(120,160,220,0.08); font-size: 22rpx; color: #9aa6bd; cursor: pointer; }
.dp-sort.on { background: var(--ac, #6366f1); color: #fff; }
.dp-sort-arrow { margin-left: 6rpx; }

/* 数据行：一行概览 + 点按展开详情 */
.dp-list { max-height: 60vh; overflow-y: auto; }
.dp-item { border-bottom: 2rpx solid rgba(120,160,220,0.08); }
.dp-item-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8rpx 12rpx; padding: 14rpx 8rpx; cursor: pointer; }
.dp-item-head:hover { background: rgba(120,160,220,0.06); }
.dp-cell { font-size: 22rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-cell.company { flex: 1 1 150rpx; }
.dp-cell.line { flex: 0 0 84rpx; font-weight: 700; }
.dp-cell.org { flex: 0 0 150rpx; }
.dp-cell.record { flex: 1 1 210rpx; font-size: 19rpx; color: #9aa6bd; }
.dp-cell.speed { flex: 0 0 120rpx; font-weight: 700; }
.dp-cell.over { flex: 0 0 210rpx; display: flex; align-items: center; gap: 6rpx; }
.dp-cell.arrow { flex: 0 0 28rpx; text-align: center; color: #9aa6bd; font-size: 20rpx; }
.dp-org { display: flex; align-items: center; gap: 8rpx; }
/* 营运公司徽标：与实时车辆面板同款（金色圆形序号 + 短名 / 非集团用公司自己的标） */
.org-tag { display: inline-flex; align-items: center; max-width: 100%; min-width: 0; background: linear-gradient(135deg, rgba(251,191,36,0.18), rgba(251,191,36,0.06)); border: 2rpx solid rgba(251,191,36,0.42); border-radius: 999rpx; padding: 2rpx 16rpx 2rpx 2rpx; white-space: nowrap; box-shadow: inset 0 1rpx 0 rgba(255,255,255,0.14), 0 3rpx 8rpx rgba(251,191,36,0.12); }
.org-no { display: inline-flex; align-items: center; justify-content: center; width: 36rpx; height: 36rpx; border-radius: 50%; font-size: 24rpx; font-weight: 800; color: #1a1205; background: linear-gradient(135deg, #fde68a, #fbbf24 45%, #f59e0b); box-shadow: 0 4rpx 12rpx rgba(251,191,36,0.5), inset 0 1rpx 0 rgba(255,255,255,0.6); margin-right: 10rpx; flex-shrink: 0; }
.org-name { font-size: 18rpx; line-height: 1; font-weight: 700; color: #fde68a; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1rpx 2rpx rgba(0,0,0,0.3); }
.org-tag.foreign { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.18); }
.org-logo { width: 36rpx; height: 36rpx; border-radius: 50%; margin-right: 10rpx; flex-shrink: 0; }
.org-tag.foreign .org-name { color: rgba(255,255,255,0.9); }
.dp-unit { font-size: 17rpx; color: #7f8aa3; margin-left: 4rpx; font-weight: 400; }
.dp-badge { display: inline-block; min-width: 36rpx; padding: 2rpx 10rpx; border-radius: 999rpx; text-align: center; font-size: 19rpx; }
.dp-driver-tag { display: inline-block; padding: 2rpx 8rpx; border-radius: 8rpx; border: 1rpx solid; font-size: 17rpx; white-space: nowrap; }
.dp-item-detail { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8rpx 20rpx; padding: 12rpx 18rpx 16rpx; background: rgba(120,160,220,0.05); }
.dp-dcell { display: flex; justify-content: space-between; gap: 12rpx; font-size: 19rpx; min-width: 0; }
.dp-dcell.full { grid-column: 1 / -1; }
.dp-dk { color: #9aa6bd; flex: 0 0 auto; }
.dp-dv { color: #e8edf6; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-empty { display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx; text-align: center; }
.dp-empty-big { font-size: 72rpx; opacity: 0.5; }
.dp-empty-txt { font-size: 24rpx; color: #9aa6bd; margin-top: 16rpx; }

/* 分页：两行 */
.dp-pager { display: flex; flex-direction: column; gap: 10rpx; margin-top: 14rpx; padding: 12rpx; border-radius: 14rpx; background: rgba(120,160,220,0.06); }
.dp-pg-top { display: flex; align-items: center; flex-wrap: wrap; gap: 10rpx; }
.dp-pg-info { flex: 1 1 200rpx; font-size: 20rpx; color: #c4cddd; white-space: nowrap; }
.dp-pg-size { display: flex; align-items: center; gap: 6rpx; font-size: 19rpx; color: #9aa6bd; }
.dp-pg-size-opt { padding: 6rpx 12rpx; border-radius: 10rpx; background: rgba(120,160,220,0.1); cursor: pointer; }
.dp-pg-size-opt.on { background: var(--ac, #6366f1); color: #fff; }
.dp-pg-jump { display: flex; align-items: center; gap: 6rpx; font-size: 19rpx; color: #9aa6bd; }
.dp-pg-jump-input { width: 72rpx; height: 48rpx; line-height: 48rpx; text-align: center; border-radius: 8rpx; background: rgba(120,160,220,0.1); color: #e8edf6; font-size: 19rpx; }
.dp-pg-nav { display: flex; align-items: center; gap: 10rpx; }
.dp-pg-arrow { flex: 0 0 auto; padding: 10rpx 14rpx; border-radius: 12rpx; background: rgba(120,160,220,0.12); font-size: 20rpx; color: #e8edf6; cursor: pointer; white-space: nowrap; }
.dp-pg-arrow.dis { opacity: 0.35; pointer-events: none; }
.dp-pg-nums { flex: 1 1 auto; min-width: 0; white-space: nowrap; }
.dp-pg-nums-inner { display: inline-flex; gap: 6rpx; }
.dp-pg-num { display: inline-block; min-width: 44rpx; padding: 8rpx 10rpx; text-align: center; border-radius: 10rpx; background: rgba(120,160,220,0.08); font-size: 20rpx; cursor: pointer; }
.dp-pg-num.on { background: var(--ac, #6366f1); color: #fff; }
.dp-pg-num.gap { background: transparent; color: #7f8aa3; }
.dp-foot { margin-top: 12rpx; font-size: 19rpx; color: #7f8aa3; }

/* 窄屏：详情改单列，跳页隐藏，按钮更紧凑 */
@media (max-width: 720px) {
  .dp-item-detail { grid-template-columns: 1fr; }
  .dp-pg-jump { display: none; }
  .dp-pg-arrow { padding: 10rpx 10rpx; font-size: 19rpx; }
  .dp-pg-num { min-width: 40rpx; padding: 8rpx; }
  /* 窄屏两行：公司/线路/自编号/箭头 → 记录时间/车速/超速 */
  .dp-cell.company { order: 1; }
  .dp-cell.line { order: 2; }
  .dp-cell.org { order: 3; }
  .dp-cell.arrow { order: 4; }
  .dp-cell.record { order: 5; flex: 1 1 200rpx; }
  .dp-cell.speed { order: 6; }
  .dp-cell.over { order: 7; }
}
</style>
