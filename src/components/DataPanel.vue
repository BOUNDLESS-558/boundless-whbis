<template>
  <!-- 数据面板：每辆车的营运档案（最高车速 / 超速次数 / 上下线 / 发车次数 / 调配 / 公司）
       数据来自 Actions 每 15 分钟采集落盘的 src/static/vehicle-ops/profile.json -->
  <view class="dp-card">
    <view class="dp-head">
      <text class="dp-grip" title="按住拖动窗口" @click.stop>⣿</text>
      <view class="dp-title-wrap">
        <text class="dp-title">📊 数据面板</text>
        <text class="dp-sub">{{ stamp || '尚未同步' }} · {{ rows.length }} 辆</text>
      </view>
      <view class="dp-head-ops" @click.stop>
        <CopyPill label="导出" :disabled="!rows.length" @copy="onCopy" />
        <view class="dp-mini" :title="loading ? '同步中' : '同步最新数据'" @click="onSync">{{ loading ? '…' : '↻' }}</view>
        <view class="dp-mini" title="关闭" @click="$emit('close')">✕</view>
      </view>
    </view>

    <view class="dp-body">
      <!-- 筛选 + 排序工具条 -->
      <view class="dp-toolbar">
        <input
          class="dp-search"
          v-model="keyword"
          type="text"
          placeholder="筛选自编号 / 线路 / 公司"
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
        <text class="dp-empty-txt">暂无营运数据。点右上角「↻」同步项目内采集数据（需 Actions 已运行）。</text>
      </view>

      <scroll-view class="dp-table-scroll" scroll-y v-else>
        <view class="dp-row dp-thead">
          <text class="dp-c org">自编号</text>
          <text class="dp-c line">线路</text>
          <text class="dp-c speed">最高车速</text>
          <text class="dp-c over">超速次数</text>
          <text class="dp-c">上线</text>
          <text class="dp-c">下线</text>
          <text class="dp-c">发车</text>
          <text class="dp-c">调配</text>
          <text class="dp-c company">公司</text>
        </view>
        <view class="dp-row" v-for="r in rows" :key="r.orgId">
          <text class="dp-c org" :title="r.orgId">{{ fmtNo(r.orgId) }}</text>
          <text class="dp-c line" :title="(r.lines || []).join('/')">{{ (r.lines || []).slice(-1)[0] || '—' }}</text>
          <text class="dp-c speed">{{ r.maxSpeed }}<text class="dp-unit">km/h</text></text>
          <text class="dp-c over">
            <text class="dp-badge" :class="{ hot: r.speedCount > 0 }">{{ r.speedCount }}</text>
          </text>
          <text class="dp-c small">{{ shortTime(r.onlineAt) }}</text>
          <text class="dp-c small">{{ shortTime(r.offlineAt) }}</text>
          <text class="dp-c">{{ r.departures }}</text>
          <text class="dp-c small" :title="transferText(r)">{{ (r.transfers || []).length }}</text>
          <text class="dp-c company" :title="r.company">{{ shortCompany(r.company) }}</text>
        </view>
      </scroll-view>

      <view class="dp-foot">
        <text>超速阈值 {{ speedLimit }} km/h · 数据每 15 分钟更新 · 自编号首位判定营运公司</text>
      </view>
    </view>
  </view>
</template>

<script>
import { copyTable } from '../utils/clipboard.js'
import { formatBusNo } from '../utils/busNumber.js'
import { bindFloatDrag } from '../utils/panelPos.js'
import CopyPill from './CopyPill.vue'

const PROFILE_URL = 'static/vehicle-ops/profile.json'

const SORTS = [
  { key: 'maxSpeed', label: '车速' },
  { key: 'speedCount', label: '超速' },
  { key: 'departures', label: '发车' },
  { key: 'orgId', label: '编号' },
]

export default {
  name: 'DataPanel',
  components: { CopyPill },
  data() {
    return {
      all: [],
      stamp: '',
      speedLimit: 60,
      loading: false,
      keyword: '',
      sortKey: 'maxSpeed',
      desc: true,
      sortOptions: SORTS,
    }
  },
  computed: {
    rows() {
      const kw = this.keyword.trim().toLowerCase()
      let list = this.all
      if (kw) {
        list = list.filter((r) => {
          return String(r.orgId).includes(kw)
            || (r.lines || []).some((l) => String(l).includes(kw))
            || String(r.company || '').toLowerCase().includes(kw)
        })
      }
      const key = this.sortKey
      const dir = this.desc ? -1 : 1
      return [...list].sort((a, b) => {
        const av = a[key] || 0
        const bv = b[key] || 0
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
        return String(av).localeCompare(String(bv)) * dir
      })
    },
  },
  mounted() {
    bindFloatDrag(this, '.dp-grip', 'data-panel')
    this.load()
  },
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
    transferText(r) {
      return (r.transfers || []).map((t) => `${t.from}→${t.to} ${t.at}`).join('\n') || '无调配'
    },
    load() {
      // 从项目内静态资产读取（H5 子路径部署用 asset() 解析基址）
      import('../utils/asset.js').then(({ assetUrl }) => {
        fetch(assetUrl(PROFILE_URL), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((j) => this.apply(j))
          .catch((e) => console.warn('[DataPanel] 读取失败', e))
      })
    },
    apply(j) {
      if (!j || !j.buses) return
      this.all = Object.values(j.buses)
      this.stamp = j.updated || ''
      this.speedLimit = j.speedLimit || 60
    },
    onSync() {
      this.loading = true
      this.load()
      setTimeout(() => {
        this.loading = false
        uni.showToast({ title: '已同步', icon: 'none' })
      }, 400)
    },
    onSort(key) {
      if (this.sortKey === key) this.desc = !this.desc
      else { this.sortKey = key; this.desc = true }
    },
    onCopy() {
      const columns = ['自编号', '线路', '最高车速', '超速次数', '上线时间', '下线时间', '发车次数', '调配记录', '所属公司']
      const rows = this.rows.map((r) => [
        this.fmtNo(r.orgId),
        (r.lines || []).join('/'),
        String(r.maxSpeed),
        String(r.speedCount),
        r.onlineAt || '',
        r.offlineAt || '',
        String(r.departures),
        this.transferText(r).replace(/\n/g, '; '),
        r.company || '',
      ])
      copyTable({ title: `武汉公交营运数据 ${this.stamp}`, columns, rows })
    },
  },
}
</script>

<style scoped>
.dp-card { width: 1200rpx; max-width: 94vw; background: rgba(16,22,38,0.96); border: 2rpx solid rgba(120,160,220,0.28); border-radius: 20rpx; color: #e8edf6; overflow: hidden; }
.dp-head { display: flex; align-items: center; padding: 20rpx 24rpx; border-bottom: 2rpx solid rgba(120,160,220,0.16); }
.dp-grip { color: #7f8aa3; margin-right: 14rpx; cursor: grab; }
.dp-title-wrap { flex: 1; display: flex; flex-direction: column; }
.dp-title { font-size: 30rpx; font-weight: 700; }
.dp-sub { font-size: 20rpx; color: #9aa6bd; margin-top: 4rpx; }
.dp-head-ops { display: flex; align-items: center; gap: 12rpx; }
.dp-mini { width: 48rpx; height: 48rpx; line-height: 48rpx; text-align: center; border-radius: 12rpx; background: rgba(120,160,220,0.12); cursor: pointer; }
.dp-body { padding: 16rpx 20rpx 20rpx; }
.dp-toolbar { display: flex; flex-direction: column; gap: 12rpx; margin-bottom: 12rpx; }
.dp-search { width: 100%; box-sizing: border-box; padding: 14rpx 18rpx; border-radius: 12rpx; background: rgba(120,160,220,0.08); color: #e8edf6; font-size: 24rpx; }
.dp-sorts { display: flex; gap: 10rpx; flex-wrap: wrap; }
.dp-sort { padding: 8rpx 18rpx; border-radius: 999rpx; background: rgba(120,160,220,0.08); font-size: 22rpx; color: #9aa6bd; cursor: pointer; }
.dp-sort.on { background: var(--ac, #6366f1); color: #fff; }
.dp-sort-arrow { margin-left: 6rpx; }
.dp-table-scroll { max-height: 60vh; overflow-y: auto; }
.dp-row { display: flex; align-items: center; padding: 12rpx 8rpx; border-bottom: 2rpx solid rgba(120,160,220,0.08); }
.dp-thead { position: sticky; top: 0; background: #101a2e; color: #9aa6bd; font-size: 20rpx; z-index: 2; }
.dp-c { flex: 1; font-size: 22rpx; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-c.org { flex: 1.2; }
.dp-c.line { flex: 0.8; }
.dp-c.speed { flex: 1; }
.dp-c.over { flex: 0.7; }
.dp-c.company { flex: 1.2; }
.dp-c.small { font-size: 19rpx; color: #9aa6bd; }
.dp-unit { font-size: 17rpx; color: #7f8aa3; margin-left: 4rpx; }
.dp-badge { display: inline-block; min-width: 36rpx; padding: 2rpx 10rpx; border-radius: 999rpx; background: rgba(120,160,220,0.12); text-align: center; }
.dp-badge.hot { background: #ef4444; color: #fff; }
.dp-empty { display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx; text-align: center; }
.dp-empty-big { font-size: 72rpx; opacity: 0.5; }
.dp-empty-txt { font-size: 24rpx; color: #9aa6bd; margin-top: 16rpx; }
.dp-foot { margin-top: 12rpx; font-size: 19rpx; color: #7f8aa3; }
</style>
