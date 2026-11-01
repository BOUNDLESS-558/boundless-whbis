<template>
  <view class="db-mod" :class="{ plain: plain }">
    <!-- 头部卡：标题 + 三态统计 + 搜索 + 前缀/状态筛选 -->
    <view class="db-row db-head">
      <view class="db-head-text">
        <view class="db-title">线路数据库</view>
        <view class="db-sub">集团全量线路 · 本地摘要 · 含已停运历史线</view>
      </view>
      <text class="db-count">共 {{ source === 'hanqi' ? hanqiLines.length : total }} 条</text>
    </view>

    <!-- 数据源：武汉公交（自有） / 汉奇智慧出行（第三方实时接口，直连） -->
    <view class="db-row db-src">
      <text class="db-fl">数据源</text>
      <view class="db-chips">
        <view class="db-chip" :class="{ on: source === 'whbus' }" @click="setSource('whbus')">武汉公交</view>
        <view class="db-chip" :class="{ on: source === 'hanqi' }" @click="setSource('hanqi')">汉奇公交</view>
      </view>
    </view>

    <template v-if="source === 'whbus'">
    <view class="db-div"></view>

    <view class="db-row db-stat">
      <view class="db-st"><text class="db-st-n live">{{ stats.live }}</text><text class="db-st-l">营运中</text></view>
      <view class="db-st"><text class="db-st-n ended">{{ stats.ended }}</text><text class="db-st-l">已收班</text></view>
      <view class="db-st"><text class="db-st-n off">{{ stats.off }}</text><text class="db-st-l">已停运</text></view>
    </view>

    <view class="db-div"></view>

    <view class="db-row db-search">
      <text class="db-search-icon">🔍</text>
      <input
        class="db-search-input"
        v-model="kw"
        type="text"
        placeholder="搜索线路号 / 起讫站，如 337 / 武昌火车站"
        placeholder-class="db-search-ph"
      />
      <text class="db-search-clear" v-if="kw" @click="kw = ''">✕</text>
    </view>

    <view class="db-filter">
      <text class="db-fl">线路</text>
      <view class="db-chips">
        <view
          v-for="p in prefixes"
          :key="p"
          class="db-chip"
          :class="{ on: prefix === p }"
          @click="prefix = p"
        >{{ p }}</view>
      </view>
    </view>

    <view class="db-filter">
      <text class="db-fl">状态</text>
      <view class="db-chips">
        <view
          v-for="s in statusOpts"
          :key="s.key"
          class="db-chip"
          :class="{ on: status === s.key }"
          @click="status = s.key"
        >{{ s.label }}</view>
      </view>
    </view>
    </view>
  </view>

  <!-- 结果列表：武汉公交 -->
  <view class="db-mod db-list" :class="{ plain: plain }" v-if="source === 'whbus'">
    <view class="db-row db-lhead">
      <text class="db-lh-t">匹配 {{ filtered.length }} 条</text>
      <view class="db-copy" v-if="filtered.length" @click.stop="copyFiltered" title="一键复制当前筛选命中的全部线路信息（TSV，可直接粘贴进表格）">⧉ 复制</view>
      <text class="db-lh-s" v-if="filtered.length">按线路号排序</text>
    </view>
    <view class="db-div"></view>

    <view class="db-item" v-for="l in visibleLines" :key="l.no" @click="openDetail(l)">
      <text class="db-no">{{ l.no }}</text>
      <view class="db-item-body">
        <text class="db-route">{{ l.start || '起点未知' }} → {{ l.end || '终点未知' }}</text>
        <text class="db-meta">{{ l.stops ? l.stops + ' 站' : '站数未知' }} · {{ l.dirs.length > 1 ? '双向' : '单向' }} · {{ l.price ? '¥' + l.price : '票价未知' }}</text>
      </view>
      <text class="db-badge" :class="'db-badge-' + statusOf(l).key">{{ statusOf(l).label }}</text>
      <text class="db-go">›</text>
    </view>

    <view class="db-none" v-if="!filtered.length">
      <text class="db-none-t">没有符合条件的线路</text>
    </view>
    <view class="db-more" v-if="filtered.length > shown" @click="loadMore">
      加载更多（剩余 {{ filtered.length - shown }} 条）
    </view>
  </view>

  <!-- 结果列表：汉奇公交（第三方实时接口，直连；点击直接进实时地图） -->
  <view class="db-mod db-list" :class="{ plain: plain }" v-else>
    <view class="db-row db-lhead">
      <text class="db-lh-t">汉奇公交 · 匹配 {{ hanqiFiltered.length }} 条</text>
      <text class="db-lh-s" v-if="hanqiLoading">加载中…</text>
      <text class="db-go" v-else @click="loadHanqi" title="重新扫描汉奇线路">↻</text>
    </view>
    <view class="db-div"></view>

    <view class="db-item" v-for="l in hanqiVisible" :key="l.lineId" @click="openHanqi(l)">
      <text class="db-no hanqi">{{ l.lineNo }}</text>
      <view class="db-item-body">
        <text class="db-route">{{ l.first && l.last ? l.first + ' – ' + l.last : '运营中' }} · {{ l.price || '票价未知' }}</text>
        <text class="db-meta">{{ (l.dirs && l.dirs.length > 1) ? '双向' : '单向' }}</text>
      </view>
      <text class="db-go">›</text>
    </view>

    <view class="db-none" v-if="!hanqiLoading && !hanqiFiltered.length">
      <text class="db-none-t">{{ hanqiErr || '暂无汉奇公交线路（或扫描失败）' }}</text>
    </view>
    <view class="db-more" v-if="hanqiFiltered.length > shown" @click="loadMore">
      加载更多（剩余 {{ hanqiFiltered.length - shown }} 条）
    </view>
  </view>

  <!-- 详情弹层（只展示本地已有摘要） -->
  <view class="db-mask" v-if="detail" @click="closeDetail"></view>
  <view class="db-pop" v-if="detail">
    <view class="db-pop-head">
      <text class="db-pop-no">{{ detail.no }}</text>
      <text class="db-badge" :class="'db-badge-' + statusOf(detail).key">{{ statusOf(detail).label }}</text>
      <text class="db-pop-close" @click="closeDetail">✕</text>
    </view>
    <view class="db-pop-route">{{ detail.start || '起点未知' }} ⇄ {{ detail.end || '终点未知' }}</view>
    <view class="db-pop-grid">
      <view class="db-cell"><text class="db-k">首班</text><text class="db-v">{{ detail.early || '未知' }}</text></view>
      <view class="db-cell"><text class="db-k">末班</text><text class="db-v">{{ detail.last || '未知' }}</text></view>
      <view class="db-cell"><text class="db-k">票价</text><text class="db-v">{{ detail.price ? '¥' + detail.price : '未知' }}</text></view>
      <view class="db-cell"><text class="db-k">站数</text><text class="db-v">{{ detail.stops ? detail.stops + ' 站' : '未知' }}</text></view>
      <view class="db-cell"><text class="db-k">方向</text><text class="db-v">{{ detail.dirs.length > 1 ? '双向' : '单向' }}</text></view>
      <view class="db-cell"><text class="db-k">名称</text><text class="db-v">{{ detail.name || detail.no }}</text></view>
    </view>
    <view class="db-pop-code">查询编码 lineCode：{{ detail.code }}</view>
    <view class="db-pop-note" v-if="statusOf(detail).key === 'off'">
      该线路已无站点数据（已停运 / 历史线），后端不提供逐站明细，仅保留以上摘要信息。
    </view>
    <view class="db-pop-btns">
      <view class="db-pbtn" @click="closeDetail">关闭</view>
      <view class="db-pbtn primary" v-if="detail.status !== '停运'" @click="openLive">在实时查询中打开 ›</view>
    </view>
  </view>
</template>

<script>
import { allLines, linePrefix, lineStatus, LINE_COUNT } from '../utils/lineIndex.js'
import { buildLineCode } from '../config.js'
import { fetchHanqiLines } from '../utils/hanqi.js'

// 窗口化渲染：一次只挂 80 条，避免 1137 行全量 DOM 拖慢 H5 滚动
const PAGE = 80

export default {
  name: 'LineDb',
  props: {
    // 裸形态：挂在地图悬浮窗（FloatWin）里时，窗壳只有一张，头卡与列表卡不再各自套玻璃卡
    plain: { type: Boolean, default: false },
  },
  data() {
    return {
      all: [],
      kw: '',
      prefix: '全部',
      status: '全部',
      prefixes: ['全部', '数字', '电', 'BRT', 'K', 'D'],
      statusOpts: [
        { key: '全部', label: '全部' },
        { key: 'live', label: '营运中' },
        { key: 'ended', label: '已收班' },
        { key: 'off', label: '已停运' },
      ],
      shown: PAGE,
      detail: null,
      // 数据源：whbus（武汉公交，自有）/ hanqi（汉奇智慧出行，第三方实时接口）
      source: 'whbus',
      hanqiLines: [],
      hanqiLoading: false,
      hanqiErr: '',
    }
  },
  computed: {
    total() {
      return this.all.length || LINE_COUNT
    },
    // 三态统计：对全库跑一次 lineStatus（当前时刻），供头部展示
    stats() {
      const s = { live: 0, ended: 0, off: 0 }
      for (const l of this.all) s[lineStatus(l).key]++
      return s
    },
    filtered() {
      const q = this.kw.trim().toUpperCase()
      return this.all.filter((l) => {
        if (this.prefix !== '全部' && linePrefix(l.no) !== this.prefix) return false
        if (this.status !== '全部' && lineStatus(l).key !== this.status) return false
        if (q) {
          const hay = `${l.no} ${l.name || ''} ${l.start || ''} ${l.end || ''}`.toUpperCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
    },
    visibleLines() {
      return this.filtered.slice(0, this.shown)
    },
    hanqiFiltered() {
      const q = this.kw.trim().toUpperCase()
      return this.hanqiLines.filter((l) =>
        !q || String(l.lineName || '').toUpperCase().includes(q)
      )
    },
    hanqiVisible() {
      return this.hanqiFiltered.slice(0, this.shown)
    },
  },
  watch: {
    kw() { this.shown = PAGE },
    prefix() { this.shown = PAGE },
    status() { this.shown = PAGE },
  },
  // ⚠ 组件不触发页面生命周期：原来写成 onLoad 会永远不执行，列表恒空
  created() {
    this.all = allLines()
  },
  methods: {
    statusOf(l) {
      return lineStatus(l)
    },
    // 一键复制当前筛选命中的全部线路（TSV：编号/起点/终点/站数/方向/票价/首班/末班/状态/lineCode），
    // 复制的是 filtered 全量（不是窗口化渲染的 visibleLines），粘进表格即成清单
    copyFiltered() {
      const list = this.filtered
      if (!list.length) {
        uni.showToast({ title: '没有符合条件的线路', icon: 'none' })
        return
      }
      const rows = list.map((l) =>
        [
          l.no,
          l.start || '未知',
          l.end || '未知',
          l.stops ? l.stops + ' 站' : '未知',
          l.dirs && l.dirs.length > 1 ? '双向' : '单向',
          l.price ? '¥' + l.price : '未知',
          l.early || '未知',
          l.last || '未知',
          this.statusOf(l).label,
          l.code || l.no,
        ].join('\t')
      )
      const data =
        `线路库匹配 ${list.length} 条\n` +
        '编号\t起点\t终点\t站数\t方向\t票价\t首班\t末班\t状态\tlineCode\n' +
        rows.join('\n')
      uni.setClipboardData({
        data,
        success: () => uni.showToast({ title: `已复制 ${list.length} 条线路`, icon: 'none' }),
        fail: () => uni.showToast({ title: '复制失败', icon: 'none' }),
      })
    },
    loadMore() {
      this.shown += PAGE
    },
    // 切换数据源：武汉公交 / 汉奇公交（首次切到汉奇时懒加载扫描一遍）
    setSource(s) {
      if (s === this.source) return
      this.source = s
      this.shown = PAGE
      if (s === 'hanqi' && !this.hanqiLines.length && !this.hanqiLoading) this.loadHanqi()
    },
    // 扫描汉奇线路：用武汉锚点散点覆盖全市，合并去重（仅 7 个轻量请求）
    async loadHanqi() {
      this.hanqiLoading = true
      this.hanqiErr = ''
      try {
        const list = await fetchHanqiLines()
        list.sort((a, b) => String(a.lineName).localeCompare(String(b.lineName), 'zh'))
        this.hanqiLines = list
      } catch (e) {
        this.hanqiErr = '汉奇接口扫描失败，点 ↻ 重试'
      } finally {
        this.hanqiLoading = false
      }
    },
    // 汉奇线路：直接进实时地图（数据源标志由宿主透传给 LineMap）
    openHanqi(l) {
      this.$emit('pick', {
        source: 'hanqi',
        lineId: l.lineId,
        lineName: l.lineName,
        direction: 0,
        startStop: '',
        endStop: '',
      })
    },
    openDetail(l) {
      this.detail = l
    },
    closeDetail() {
      this.detail = null
    },
    // 营运线：上抛选线事件给宿主页（由 line 页拉取实时详情；停运线无在线数据，不提供此入口）
    openLive() {
      const l = this.detail
      const code = l.code && String(l.code).includes('-') ? l.code : buildLineCode(l.code || l.no, 0)
      this.$emit('pick', {
        lineCode: code,
        lineName: l.no,
        direction: 0,
        startStop: l.start || '',
        endStop: l.end || '',
      })
      this.closeDetail()
    },
  },
}
</script>

<style scoped>
/* 玻璃卡：与首页同一套语言 */
.db-mod {
  position: relative;
  box-sizing: border-box;
  border-radius: 28rpx;
  background: rgba(17, 22, 33, 0.86);
  backdrop-filter: blur(30px) saturate(170%);
  -webkit-backdrop-filter: blur(30px) saturate(170%);
  border: 2rpx solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 26rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.08);
}
.db-list {
  overflow: hidden;
}
/* 裸形态：只去掉卡壳，内边距与细线分区照旧（窗体自己留边） */
.db-mod.plain {
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.db-mod.plain + .db-mod.plain {
  margin-top: 22rpx;
}
.db-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.db-div {
  height: 2rpx;
  margin: 0 24rpx;
  background: rgba(255, 255, 255, 0.07);
}
/* 头部 */
.db-head {
  padding: 26rpx 26rpx 22rpx;
}
.db-head-text {
  flex: 1;
  min-width: 0;
}
.db-title {
  font-size: 36rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 1rpx;
}
.db-sub {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.46);
}
.db-count {
  flex: 0 0 auto;
  font-size: 24rpx;
  font-weight: 700;
  color: #a5b4fc;
}
/* 三态统计 */
.db-stat {
  padding: 20rpx 26rpx;
  gap: 0;
}
.db-st {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}
.db-st-n {
  font-size: 40rpx;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.db-st-n.live { color: #34d399; }
.db-st-n.ended { color: #fbbf24; }
.db-st-n.off { color: #94a3b8; }
.db-st-l {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.5);
}
/* 搜索凹槽 */
.db-search {
  margin: 22rpx 26rpx 6rpx;
  padding: 0 20rpx;
  height: 76rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  border-radius: 18rpx;
}
.db-search-icon {
  font-size: 26rpx;
  opacity: 0.6;
}
.db-search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 27rpx;
  color: #fff;
}
.db-search-ph {
  color: rgba(255, 255, 255, 0.32);
}
.db-search-clear {
  flex: 0 0 auto;
  padding: 0 8rpx;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.4);
}
/* 筛选行 */
.db-filter {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 14rpx 26rpx;
}
.db-fl {
  flex: 0 0 auto;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.38);
}
.db-chips {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.db-chip {
  height: 52rpx;
  line-height: 52rpx;
  padding: 0 22rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  font-size: 23rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, color 0.18s;
}
.db-chip.on {
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border-color: rgba(129, 140, 248, 0.7);
}
/* 列表 */
.db-lhead {
  padding: 18rpx 26rpx;
}
.db-lh-t {
  font-size: 24rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.82);
}
/* 复制按钮：与 LineMap 的 copy-btn 同族幽灵小圆角，hover 提到靛蓝 */
.db-copy {
  margin-left: 16rpx;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.66);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: transform 0.15s, background 0.2s, color 0.2s;
}
.db-copy:hover {
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.3);
}
.db-copy:active {
  transform: scale(0.94);
}
.db-lh-s {
  margin-left: auto;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.36);
}
.db-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 26rpx;
  box-sizing: border-box;
  cursor: pointer;
  transition: background 0.16s;
}
.db-item:hover {
  background: rgba(255, 255, 255, 0.045);
}
.db-item:active {
  background: rgba(255, 255, 255, 0.075);
}
.db-no {
  flex: 0 0 auto;
  min-width: 96rpx;
  text-align: center;
  padding: 8rpx 14rpx;
  border-radius: 14rpx;
  font-size: 26rpx;
  font-weight: 800;
  color: #062a33;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
  font-variant-numeric: tabular-nums;
}
/* 汉奇线路名（文本，非数字编号）：放宽宽度、缩小字号，沿用同款青色渐变 */
.db-no.hanqi {
  min-width: 0;
  font-size: 20rpx;
  white-space: nowrap;
  color: #062a33;
}
.db-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.db-route {
  font-size: 25rpx;
  color: rgba(255, 255, 255, 0.88);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.db-meta {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.4);
}
.db-go {
  flex: 0 0 auto;
  font-size: 32rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.28);
}
.db-none {
  padding: 56rpx 26rpx;
  text-align: center;
}
.db-none-t {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.5);
}
.db-more {
  margin: 8rpx 26rpx 26rpx;
  height: 76rpx;
  line-height: 76rpx;
  text-align: center;
  border-radius: 18rpx;
  font-size: 25rpx;
  font-weight: 600;
  color: #a5b4fc;
  background: rgba(99, 102, 241, 0.12);
  border: 2rpx solid rgba(129, 140, 248, 0.3);
  cursor: pointer;
}
/* 状态徽标：营运中翠绿 / 已收班琥珀 / 已停运石板灰（避开上下行方向色） */
.db-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 36rpx;
  padding: 0 16rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  font-size: 20rpx;
  line-height: 1;
  white-space: nowrap;
  font-weight: 700;
  border: 2rpx solid transparent;
}
.db-badge-live {
  color: #34d399;
  background: rgba(16, 185, 129, 0.16);
  border-color: rgba(52, 211, 153, 0.42);
}
.db-badge-ended {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(251, 191, 36, 0.38);
}
.db-badge-off {
  color: #94a3b8;
  background: rgba(100, 116, 139, 0.16);
  border-color: rgba(148, 163, 184, 0.34);
}
/* 详情弹层 */
.db-mask {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 60;
  background: rgba(4, 8, 18, 0.6);
  backdrop-filter: blur(2px);
}
.db-pop {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 61;
  width: 640rpx;
  max-width: 92vw;
  box-sizing: border-box;
  padding: 30rpx 30rpx 26rpx;
  border-radius: 30rpx;
  background: rgba(20, 26, 40, 0.97);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 30rpx 80rpx rgba(0, 0, 0, 0.6);
}
.db-pop-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.db-pop-no {
  min-width: 104rpx;
  text-align: center;
  padding: 8rpx 16rpx;
  border-radius: 16rpx;
  font-size: 34rpx;
  font-weight: 800;
  color: #062a33;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
  font-variant-numeric: tabular-nums;
}
.db-pop-close {
  margin-left: auto;
  padding: 6rpx 12rpx;
  font-size: 30rpx;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}
.db-pop-route {
  margin-top: 22rpx;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.4;
  color: #fff;
}
.db-pop-grid {
  margin-top: 24rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}
.db-cell {
  flex: 1 1 calc(50% - 7rpx);
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.db-k {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.42);
}
.db-v {
  font-size: 28rpx;
  font-weight: 700;
  color: #fff;
  word-break: break-all;
}
.db-pop-code {
  margin-top: 22rpx;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.34);
  font-variant-numeric: tabular-nums;
}
.db-pop-note {
  margin-top: 16rpx;
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: #cbd5e1;
  background: rgba(100, 116, 139, 0.16);
  border: 2rpx solid rgba(148, 163, 184, 0.28);
}
.db-pop-btns {
  margin-top: 28rpx;
  display: flex;
  gap: 16rpx;
}
.db-pbtn {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  text-align: center;
  border-radius: 18rpx;
  font-size: 26rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.db-pbtn.primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
}
</style>
