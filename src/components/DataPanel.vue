<template>
  <!-- 数据面板：每辆车的营运档案（最高车速 / 超速次数 / 上下线 / 发车次数 / 调配 / 公司）
       数据来自 Actions 每 15 分钟采集落盘的 src/static/vehicle-ops/profile.json -->
  <!-- 纯内容组件：外层由 map.vue 的 FloatWin 提供标题 / 拖动 / 关闭，这里不再画第二层卡片头 -->
  <view class="dp-body">
    <!-- 操作行：同步 / 导出 / 数据时次 -->
    <view class="dp-actions">
      <text class="dp-stamp">{{ stamp ? stamp + ' · ' + rows.length + ' 辆' : '尚未同步 · 0 辆' }}</text>
      <view class="dp-ops">
        <CopyPill label="导出" :disabled="!rows.length" @copy="onCopy" />
        <view class="dp-mini" :title="loading ? '同步中' : '同步最新数据'" @click="onSync">{{ loading ? '…' : '↻ 同步' }}</view>
      </view>
    </view>
    <!-- 筛选 + 排序工具条 -->
    <view class="dp-toolbar">
      <input
        class="dp-search"
        v-model="keyword"
        type="text"
        placeholder="筛选自编号 / 营运线路号 / 公司"
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
      <text class="dp-empty-txt">暂无营运数据。点上方「↻ 同步」读取项目内采集数据（需 Actions 已运行）。</text>
    </view>

      <scroll-view class="dp-table-scroll" scroll-y v-else>
        <!-- 每行一辆车：所属公司 / 线路号 / 自编号 / 首次上线 / 最终下线 / 最高车速 /
             超速次数 / 发车次数 / 调配记录 全部完整展示，长行可横向滚动 -->
        <view class="dp-row dp-thead">
          <text class="dp-c company">所属营运公司</text>
          <text class="dp-c line">营运线路号</text>
          <text class="dp-c org">自编号</text>
          <text class="dp-c time">首次上线</text>
          <text class="dp-c time">最终下线</text>
          <text class="dp-c speed">最高车速</text>
          <text class="dp-c over">超速次数</text>
          <text class="dp-c">发车次数</text>
          <text class="dp-c trans">车辆调配记录</text>
        </view>
        <view class="dp-row" v-for="r in rows" :key="r.orgId">
          <text class="dp-c company" :title="r.company">{{ r.company || '—' }}</text>
          <text class="dp-c line" :title="'历史线路：' + (r.lines || []).join(' / ')">{{ r.lineNo || (r.lines || [])[0] || '—' }}</text>
          <text class="dp-c org" :title="r.orgId">{{ fmtNo(r.orgId) }}</text>
          <text class="dp-c time small">{{ r.onlineAt || '—' }}</text>
          <text class="dp-c time small">{{ r.offlineAt || '—' }}</text>
          <text class="dp-c speed">{{ r.maxSpeed }}<text class="dp-unit">km/h</text></text>
          <text class="dp-c over">
            <text class="dp-badge" :class="{ hot: r.speedCount > 0 }">{{ r.speedCount }}</text>
          </text>
          <text class="dp-c">{{ r.departures }}</text>
          <text class="dp-c trans small" :title="transferText(r)">{{ transferText(r) }}</text>
        </view>
      </scroll-view>

  <view class="dp-foot">
    <text>超速阈值 {{ speedLimit }} km/h · 数据每 15 分钟更新 · 自编号首位判定营运公司</text>
  </view>
</view>
</template>

<script>
import { copyTable } from '../utils/clipboard.js'
import { formatBusNo } from '../utils/busNumber.js'
import CopyPill from './CopyPill.vue'

const PROFILE_URL = 'static/vehicle-ops/profile.json'

const SORTS = [
  { key: 'maxSpeed', label: '车速' },
  { key: 'speedCount', label: '超速' },
  { key: 'departures', label: '发车' },
  { key: 'orgId', label: '编号' },
  { key: 'onlineAt', label: '上线' },
  { key: 'offlineAt', label: '下线' },
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
            || String(r.lineNo || '').includes(kw)
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
      const columns = ['所属营运公司', '营运线路号', '自编号', '首次上线时间', '最终下线时间', '最高车速', '超速次数', '历史发车次数', '车辆调配记录']
      const rows = this.rows.map((r) => [
        r.company || '',
        r.lineNo || (r.lines || [])[0] || '',
        this.fmtNo(r.orgId),
        r.onlineAt || '',
        r.offlineAt || '',
        String(r.maxSpeed),
        String(r.speedCount),
        String(r.departures),
        this.transferText(r).replace(/\n/g, '; '),
      ])
      copyTable({ title: `武汉公交营运数据 ${this.stamp}`, columns, rows })
    },
  },
}
</script>

<style scoped>
/* 纯内容：不再自绘卡片外壳，由外层 FloatWin 提供标题/边框/拖动/关闭 */
.dp-body { width: 100%; color: #e8edf6; }
.dp-actions { display: flex; align-items: center; justify-content: space-between; padding: 4rpx 0 14rpx; }
.dp-stamp { font-size: 19rpx; color: #9aa6bd; }
.dp-ops { display: flex; align-items: center; gap: 12rpx; }
.dp-mini { padding: 8rpx 16rpx; border-radius: 12rpx; background: rgba(120,160,220,0.12); color: #e8edf6; font-size: 20rpx; cursor: pointer; white-space: nowrap; }
.dp-toolbar { display: flex; flex-direction: column; gap: 12rpx; margin-bottom: 12rpx; }
/* 搜索框：给足高度与行高，避免自定义字体下中文被裁切；placeholder 单独设色，确保完整可见 */
.dp-search { width: 100%; box-sizing: border-box; height: 68rpx; line-height: 68rpx; padding: 0 18rpx; border-radius: 12rpx; background: rgba(120,160,220,0.08); color: #e8edf6; font-size: 24rpx; }
.dp-search-ph { color: rgba(232, 237, 246, 0.45); font-size: 24rpx; line-height: 68rpx; }
.dp-sorts { display: flex; gap: 10rpx; flex-wrap: wrap; }
.dp-sort { padding: 8rpx 18rpx; border-radius: 999rpx; background: rgba(120,160,220,0.08); font-size: 22rpx; color: #9aa6bd; cursor: pointer; }
.dp-sort.on { background: var(--ac, #6366f1); color: #fff; }
.dp-sort-arrow { margin-left: 6rpx; }
.dp-table-scroll { max-height: 60vh; overflow-y: auto; overflow-x: auto; }
.dp-row { display: flex; align-items: center; padding: 12rpx 8rpx; border-bottom: 2rpx solid rgba(120,160,220,0.08); min-width: 1500rpx; }
.dp-thead { position: sticky; top: 0; background: #101a2e; color: #9aa6bd; font-size: 20rpx; z-index: 2; }
/* 固定列宽而非均分：完整字段（公司全名/多线路/完整时间/调配记录）不被省略号截断，窄屏横向滚动查看 */
.dp-c { flex: 0 0 auto; font-size: 22rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-c.company { width: 240rpx; }
.dp-c.line { width: 140rpx; }
.dp-c.org { width: 130rpx; }
.dp-c.time { width: 220rpx; }
.dp-c.speed { width: 130rpx; }
.dp-c.over { width: 110rpx; }
.dp-c.trans { width: 360rpx; }
.dp-c.small { font-size: 19rpx; color: #9aa6bd; }
.dp-unit { font-size: 17rpx; color: #7f8aa3; margin-left: 4rpx; }
.dp-badge { display: inline-block; min-width: 36rpx; padding: 2rpx 10rpx; border-radius: 999rpx; background: rgba(120,160,220,0.12); text-align: center; }
.dp-badge.hot { background: #ef4444; color: #fff; }
.dp-empty { display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx; text-align: center; }
.dp-empty-big { font-size: 72rpx; opacity: 0.5; }
.dp-empty-txt { font-size: 24rpx; color: #9aa6bd; margin-top: 16rpx; }
.dp-foot { margin-top: 12rpx; font-size: 19rpx; color: #7f8aa3; }
</style>
