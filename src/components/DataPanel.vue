<template>
  <!-- 数据面板：按日营运档案。优先读 Vercel 按日表 API，失败回退静态 profile.json -->
  <view class="dp-body">
    <!-- 操作行：同步 / 导出 / 数据时次 -->
    <view class="dp-actions">
      <text class="dp-stamp">{{ stamp ? stamp + ' · ' + filteredCount + ' 辆' : '尚未同步 · 0 辆' }}</text>
      <view class="dp-ops">
        <CopyPill label="导出" :disabled="!filteredCount" @copy="onCopy" />
        <view class="dp-mini" :title="loading ? '同步中' : '同步最新数据'" @click="onSync">{{ loading ? '⏳ 同步中' : '🔄 同步' }}</view>
      </view>
    </view>

    <!-- 年 / 月 / 日 / 公司 / 线路 联动筛选（均含「全部」） -->
    <view class="dp-filters">
      <view class="dp-filter-row">
        <text class="dp-fl">📅 日期</text>
        <view class="dp-chips">
          <view v-for="y in yearOpts" :key="'y' + y" class="dp-chip" :class="{ on: fy === y }" @click="pickYear(y)">{{ y === '全部' ? '全部年' : y }}</view>
          <view v-for="m in monthOpts" :key="'m' + m" class="dp-chip" :class="{ on: fm === m }" @click="pickMonth(m)">{{ m === '全部' ? '全部月' : m + '月' }}</view>
        </view>
      </view>
      <view class="dp-filter-row">
        <text class="dp-fl">🗓 具体日</text>
        <view class="dp-chips">
          <view v-for="d in dayOpts" :key="'d' + d" class="dp-chip" :class="{ on: fd === d }" @click="pickDay(d)">{{ d === '全部' ? '全部日' : d }}</view>
        </view>
      </view>
      <view class="dp-filter-row">
        <text class="dp-fl">🏢 公司</text>
        <view class="dp-chips">
          <view v-for="c in companyOpts" :key="'c' + c" class="dp-chip" :class="{ on: fc === c }" @click="pickCompany(c)">{{ c === '全部' ? '全部公司' : shortCompany(c) }}</view>
        </view>
      </view>
      <view class="dp-filter-row">
        <text class="dp-fl">🚌 线路</text>
        <view class="dp-chips">
          <view v-for="l in lineOpts" :key="'l' + l" class="dp-chip" :class="{ on: fl === l }" @click="pickLine(l)">{{ l === '全部' ? '全部线路' : l }}</view>
        </view>
      </view>
    </view>

    <!-- 搜索 + 排序工具条 -->
    <view class="dp-toolbar">
      <input
        class="dp-search"
        v-model="keyword"
        type="text"
        placeholder="筛选自编号 / 线路号 / 公司"
        placeholder-class="dp-search-ph"
        confirm-type="search"
      />
      <view class="dp-sorts">
        <view
          v-for="s in sortOptions"
          :key="s.key"
          class="dp-sort"
          :class="{ on: sortKey === s.key }"
          @click="onSort(s.key)"
        >{{ s.label }}<text v-if="sortKey === s.key" class="dp-sort-arrow">{{ desc ? '↓' : '↑' }}</text></view>
      </view>
    </view>

    <view class="dp-empty" v-if="!rows.length">
      <text class="dp-empty-big">📂</text>
      <text class="dp-empty-txt">暂无符合条件的营运数据。可点「🔄 同步」读取最新数据。</text>
    </view>

    <scroll-view class="dp-table-scroll" scroll-y v-else>
      <view class="dp-row dp-thead">
        <text class="dp-c company">所属营运公司</text>
        <text class="dp-c line">营运线路号</text>
        <text class="dp-c org">自编号</text>
        <text class="dp-c record">记录时间</text>
        <text class="dp-c time">首次上线</text>
        <text class="dp-c time">最终下线</text>
        <text class="dp-c speed">最高车速</text>
        <text class="dp-c over">超速次数</text>
        <text class="dp-c depart">发车次数</text>
        <text class="dp-c trans">车辆调配记录</text>
      </view>
      <view class="dp-row" v-for="r in rows" :key="r.date + '|' + r.orgId">
        <view class="dp-c company dp-org">
          <image v-if="orgLogo(r)" class="dp-logo" :src="orgLogo(r)" mode="aspectFit" />
          <text class="dp-org-name" :title="r.company || ''">{{ orgLabel(r) }}</text>
        </view>
        <text class="dp-c line" :title="'历史线路：' + (r.lines || []).join(' / ')">{{ r.lineNo || (r.lines || [])[0] || '—' }}</text>
        <text class="dp-c org" :title="r.orgId">{{ fmtNo(r.orgId) }}</text>
        <text class="dp-c record small">{{ recordText(r) }}</text>
        <text class="dp-c time small">{{ shortTime(r.onlineAt) }}</text>
        <text class="dp-c time small">{{ shortTime(r.offlineAt) }}</text>
        <text class="dp-c speed" :style="{ color: speedColor(r.maxSpeed), fontWeight: '700' }">{{ r.maxSpeed }}<text class="dp-unit">km/h</text></text>
        <text class="dp-c over">
          <text class="dp-badge" :style="speedStyle(r.maxSpeed)">{{ r.speedCount }}</text>
        </text>
        <text class="dp-c depart">{{ r.departures }}</text>
        <text class="dp-c trans small" :title="transferText(r)">{{ transferText(r) }}</text>
      </view>
    </scroll-view>

    <!-- 分页：每页条数用户可选，箭头为 Emoji + 文字 -->
    <view class="dp-pager" v-if="pageCount > 1">
      <view class="dp-pg-size">
        <text>📄 每页</text>
        <view v-for="n in pageSizeOpts" :key="n" class="dp-pg-size-opt" :class="{ on: pageSize === n }" @click="setSize(n)">{{ n }}</view>
      </view>
      <view class="dp-pg-arrow" :class="{ dis: page <= 1 }" @click="gotoPage(page - 1)">⬅️ 上一页</view>
      <view class="dp-pg-nums">
        <view v-for="(p, i) in pageList" :key="i" class="dp-pg-num" :class="{ on: p === page, gap: p === '…' }" @click="gotoPage(p)">{{ p }}</view>
      </view>
      <view class="dp-pg-arrow" :class="{ dis: page >= pageCount }" @click="gotoPage(page + 1)">下一页 ➡️</view>
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
    pageCount() {
      return calcPageCount(this.filteredCount, this.pageSize)
    },
    pageList() { return calcPageList(this.pageCount, this.page) },
  },
  watch: {
    keyword() { this.page = 1; if (this.apiMode) this.load() },
    fy() { this.rebuildDayOpts(); this.page = 1; this.load() },
    fm() { this.rebuildDayOpts(); this.page = 1; this.load() },
    fd() { this.page = 1; this.load() },
    fc() { this.page = 1; this.load() },
    fl() { this.page = 1; this.load() },
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
    speedColor(v) {
      return SPEED_BANDS[speedBandOf(v)].color
    },
    speedStyle(v) {
      const c = this.speedColor(v)
      return { color: v > this.speedLimit ? '#fff' : c, background: v > this.speedLimit ? c : 'rgba(120,160,220,0.12)' }
    },
    orgInfo(r) {
      return companyOf({ no: r.lineNo, company: r.company, org: r.company })
    },
    orgLogo(r) { return assetUrl(this.orgInfo(r).logo) },
    orgLabel(r) { return this.orgInfo(r).label },

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
    },
    setSize(n) { this.pageSize = setPageSize(n); this.page = 1 },
  },
}
</script>

<style scoped>
.dp-body { width: 100%; color: #e8edf6; }
.dp-actions { display: flex; align-items: center; justify-content: space-between; padding: 4rpx 0 12rpx; }
.dp-stamp { font-size: 19rpx; color: #9aa6bd; }
.dp-ops { display: flex; align-items: center; gap: 12rpx; }
.dp-mini { padding: 8rpx 16rpx; border-radius: 12rpx; background: rgba(120,160,220,0.12); color: #e8edf6; font-size: 20rpx; cursor: pointer; white-space: nowrap; }
.dp-filters { display: flex; flex-direction: column; gap: 8rpx; margin-bottom: 12rpx; }
.dp-filter-row { display: flex; align-items: center; gap: 10rpx; }
.dp-fl { flex: 0 0 120rpx; font-size: 20rpx; color: #9aa6bd; }
.dp-chips { display: flex; flex: 1; flex-wrap: wrap; gap: 8rpx; }
.dp-chip { padding: 6rpx 14rpx; border-radius: 999rpx; background: rgba(120,160,220,0.1); font-size: 20rpx; color: #9aa6bd; cursor: pointer; }
.dp-chip.on { background: var(--ac, #6366f1); color: #fff; }
.dp-toolbar { display: flex; flex-direction: column; gap: 12rpx; margin-bottom: 12rpx; }
.dp-search { width: 100%; box-sizing: border-box; height: 68rpx; line-height: 68rpx; padding: 0 18rpx; border-radius: 12rpx; background: rgba(120,160,220,0.08); color: #e8edf6; font-size: 24rpx; }
.dp-search-ph { color: rgba(232, 237, 246, 0.45); font-size: 24rpx; line-height: 68rpx; }
.dp-sorts { display: flex; gap: 10rpx; flex-wrap: wrap; }
.dp-sort { padding: 8rpx 18rpx; border-radius: 999rpx; background: rgba(120,160,220,0.08); font-size: 22rpx; color: #9aa6bd; cursor: pointer; }
.dp-sort.on { background: var(--ac, #6366f1); color: #fff; }
.dp-sort-arrow { margin-left: 6rpx; }
.dp-table-scroll { max-height: 60vh; overflow-y: auto; overflow-x: auto; }
.dp-row { display: flex; align-items: center; padding: 12rpx 8rpx; border-bottom: 2rpx solid rgba(120,160,220,0.08); min-width: 1900rpx; }
.dp-thead { position: sticky; top: 0; background: #101a2e; color: #9aa6bd; font-size: 20rpx; z-index: 2; }
.dp-c { flex: 0 0 auto; font-size: 22rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-c.company { width: 240rpx; }
.dp-c.line { width: 140rpx; }
.dp-c.org { width: 130rpx; }
.dp-c.record { width: 240rpx; }
.dp-c.time { width: 200rpx; }
.dp-c.speed { width: 130rpx; }
.dp-c.over { width: 110rpx; }
.dp-c.depart { width: 130rpx; }
.dp-c.trans { width: 400rpx; padding-left: 16rpx; box-sizing: border-box; }
.dp-c.small { font-size: 19rpx; color: #9aa6bd; }
.dp-org { display: flex; align-items: center; gap: 8rpx; }
.dp-logo { width: 36rpx; height: 36rpx; flex: 0 0 auto; }
.dp-org-name { overflow: hidden; text-overflow: ellipsis; }
.dp-unit { font-size: 17rpx; color: #7f8aa3; margin-left: 4rpx; }
.dp-badge { display: inline-block; min-width: 36rpx; padding: 2rpx 10rpx; border-radius: 999rpx; background: rgba(120,160,220,0.12); text-align: center; }
.dp-empty { display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx; text-align: center; }
.dp-empty-big { font-size: 72rpx; opacity: 0.5; }
.dp-empty-txt { font-size: 24rpx; color: #9aa6bd; margin-top: 16rpx; }
.dp-pager { display: flex; align-items: center; flex-wrap: wrap; gap: 10rpx; margin-top: 12rpx; }
.dp-pg-size { display: flex; align-items: center; gap: 6rpx; font-size: 20rpx; color: #9aa6bd; }
.dp-pg-size-opt { padding: 6rpx 12rpx; border-radius: 10rpx; background: rgba(120,160,220,0.1); cursor: pointer; }
.dp-pg-size-opt.on { background: var(--ac, #6366f1); color: #fff; }
.dp-pg-arrow { padding: 8rpx 14rpx; border-radius: 12rpx; background: rgba(120,160,220,0.12); font-size: 20rpx; color: #e8edf6; cursor: pointer; }
.dp-pg-arrow.dis { opacity: 0.35; pointer-events: none; }
.dp-pg-nums { display: flex; align-items: center; gap: 6rpx; flex-wrap: wrap; }
.dp-pg-num { min-width: 40rpx; padding: 6rpx 10rpx; text-align: center; border-radius: 10rpx; background: rgba(120,160,220,0.08); font-size: 20rpx; cursor: pointer; }
.dp-pg-num.on { background: var(--ac, #6366f1); color: #fff; }
.dp-pg-num.gap { background: transparent; }
.dp-foot { margin-top: 12rpx; font-size: 19rpx; color: #7f8aa3; }
</style>
