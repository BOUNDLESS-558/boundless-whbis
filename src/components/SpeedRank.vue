<template>
  <!-- 车速榜浮窗：全市态右上角。不带遮罩，开窗时地图仍可拖拽缩放 -->
  <view class="rank-card" :class="{ folded: folded }">
    <!-- 标题整行可点折叠，折叠态本机记忆；关闭按钮单独 stop 避免误触 -->
    <view class="rank-head" :title="folded ? '展开车速榜' : '折叠车速榜'" @click="toggleFold">
      <view class="rank-title-wrap">
        <text class="rank-title">🏁 车速榜</text>
        <text class="rank-sub">{{ stampText }} · 全局 {{ total }} 辆</text>
      </view>
      <view class="rank-head-ops" @click.stop>
        <!-- 复制榜单：档位（文字 / Excel / 图片）与全站共享，左半按当前档位复制 -->
        <CopyPill label="复制" :disabled="!hasData" @copy="copyRank" />
        <view class="rank-mini fold-btn" :class="{ folded: folded }" :title="folded ? '展开' : '折叠'" @click="toggleFold">▾</view>
        <view class="rank-mini" title="关闭" @click="$emit('close')">✕</view>
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
          <!-- 名次徽章：前三名金银铜实心，其余淡描边 -->
          <view class="rk-rank">
            <text class="rk-no">{{ r.rank }}</text>
          </view>
          <!-- 主体两行：① 线路 / 方向 / 自编号（车主标识）② 走向 · 公司 · 时刻（次要信息合并） -->
          <view class="rk-main">
            <view class="rk-line1">
              <text class="rk-line">{{ r.no }}</text>
              <text class="rk-line-unit">路</text>
              <text class="rk-dir" :class="'d' + r.dir">{{ r.dir === 0 ? '上行' : '下行' }}</text>
              <text class="rk-org" :title="'自编号 ' + (r.orgId ? fmtNo(r.orgId) : '还原中')">{{ r.orgId ? fmtNo(r.orgId) : '编号还原中' }}</text>
            </view>
            <view class="rk-line2">
              <text class="rk-route" :title="r.routeText">{{ r.routeText }}</text>
              <text class="rk-sep">·</text>
              <text class="rk-company" :title="r.company">{{ shortCompany(r.company) }}</text>
              <text class="rk-sep">·</text>
              <text class="rk-time">{{ r.time }}</text>
            </view>
          </view>
          <!-- 速度：榜单主指标，右侧大数字；快慢用左侧细色条表达，数字统一高亮避免满屏红字像报警 -->
          <view class="rk-speed-wrap">
            <text class="rk-band" :style="{ background: bandColor(r.band) }"></text>
            <text class="rk-speed">{{ r.speed }}</text>
            <text class="rk-unit">km/h</text>
            <text class="rk-drift" v-if="r.drift" title="速度异常，疑似 GPS 漂移">⚠</text>
          </view>
        </view>
        <view class="rank-foot">
          <text>按当前快照车速从高到低排序 · 点行看详情并定位</text>
          <text v-if="driftCount" class="rank-foot-warn">⚠ {{ driftCount }} 辆疑似 GPS 漂移（&gt;{{ driftSpeed }} km/h），保留仅供参考</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { RANK_LIMITS, DEFAULT_RANK_LIMIT, DRIFT_SPEED, rankBySpeed } from '../utils/speedRank.js'
import { SPEED_BANDS } from '../utils/cityBus.js'
import { formatBusNo, onBusNumberReady } from '../utils/busNumber.js'
import { loadLineAsset, assetDir } from '../utils/lineAsset.js'
import { distance } from '../utils/geo.js'
import { copyTable } from '../utils/clipboard.js'
import CopyPill from './CopyPill.vue'

const RANK_LIMIT_KEY = 'whbis:rank-limit'
const RANK_FOLD_KEY = 'whbis:rank-folded'

export default {
  name: 'SpeedRank',
  components: { CopyPill },
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
      mapVersion: 0,
      // 所处站点缓存：{ [线路号|方向]: [{stopName, latitude, longitude}] }
      // 与自编号查车同源（静态线路资产），榜单变化时异步预取，复制时同步取最近站
      stopCache: {},
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
    // 完整编号映射加载完成后刷新显示
    onBusNumberReady(() => { this.mapVersion++ })
  },
  watch: {
    // 榜单行变化时异步预取涉及线路的站点明细（复制到来的瞬间必须同步，不能等请求）
    rows: {
      immediate: true,
      handler(rs) { this.prefetchStops(rs) },
    },
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
    // 公司名缩短：武汉公交集团第一公司 → 一公司（title 保留全称），省横向空间
    shortCompany(c) {
      const s = String(c || '')
      const m = s.match(/公交集团第?([一二三四五六七八九\d]+)公司/)
      if (m) return `${m[1]}公司`
      return s.replace('武汉公交集团', '') || s
    },
    fmtNo(orgId) {
      void this.mapVersion // 依赖版本号，映射就绪后重渲染
      return formatBusNo(orgId)
    },
    // 异步预取榜单车辆的站点明细：按线路号去重，命中静态资产分片（内存缓存，不重复请求）。
    // 与自编号查车 fillOrgStopNames 同源同口径，复制到来的瞬间只做同步查表。
    async prefetchStops(rows) {
      if (!rows || !rows.length) return
      if (!this._stopLoading) this._stopLoading = {}
      const nos = [...new Set(rows.map((r) => String(r.no)).filter(Boolean))]
      await Promise.all(nos.map(async (no) => {
        if (this.stopCache[no + '|0'] && this.stopCache[no + '|1']) return
        let p = this._stopLoading[no]
        if (!p) {
          p = (async () => {
            let row = null
            try { row = await loadLineAsset(no) } catch (e) { row = null }
            for (const d of [0, 1]) {
              const dirRow = row ? assetDir(row, d) : null
              const stops = (dirRow && dirRow.stops) || []
              this.stopCache[no + '|' + d] = stops
                .map((s) => ({
                  stopName: s.stopName || '',
                  latitude: parseFloat(s.latitude),
                  longitude: parseFloat(s.longitude),
                }))
                .filter((s) => !isNaN(s.latitude) && !isNaN(s.longitude))
            }
          })()
          this._stopLoading[no] = p
        }
        try { await p } finally { delete this._stopLoading[no] }
      }))
    },
    // 同步：按车辆 GPS 在已缓存的「该线路该方向」站点里找最近站名；无缓存返回空串
    nearestStop(bus) {
      if (!bus) return ''
      const stops = this.stopCache[String(bus.no) + '|' + bus.dir]
      if (!stops || !stops.length || isNaN(bus.lat) || isNaN(bus.lng)) return ''
      let best = '', bestD = Infinity
      for (const s of stops) {
        const d = distance(bus.lat, bus.lng, s.latitude, s.longitude)
        if (d < bestD) { bestD = d; best = s.stopName }
      }
      return best
    },
    // 到站状态：与车辆详情窗同口径（arrived==='1' 表示本班次已到终点）
    busState(bus) {
      return bus && bus.arrived === '1' ? '已到站' : '行驶中'
    },
    // 复制榜单：档位由 CopyPill 的全站设置决定（文字 / Excel / 图片），数据取自当前 rows
    copyRank() {
      if (!this.rows.length) {
        uni.showToast({ title: '暂无可复制的榜单数据', icon: 'none' })
        return
      }
      const dirName = (d) => (d === 0 ? '上行' : d === 1 ? '下行' : '—')
      const rows = this.rows.map((r) => [
        String(r.rank),
        r.no,
        dirName(r.dir),
        r.orgId ? this.fmtNo(r.orgId) : '',
        String(r.speed),
        r.from && r.to ? `${r.from} → ${r.to}` : (r.routeText || ''),
        r.company || '',
        this.nearestStop(r.bus) || '—',
        this.busState(r.bus),
        r.time || '',
        r.drift ? '疑似漂移' : '',
      ])
      copyTable({
        title: `车速榜 前 ${this.limit} 名 · ${this.stampText} · 全局 ${this.total} 辆`,
        columns: ['名次', '线路', '方向', '自编号', '车速(km/h)', '走向', '营运公司', '所处站点', '到站状态', 'GPS时刻', '备注'],
        rows,
        toast: `已复制车速榜前 ${this.limit} 名`,
        imageToast: `已复制车速榜前 ${this.limit} 名为图片`,
        excelToast: `已复制车速榜前 ${this.limit} 名为 Excel 表格`,
      })
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
  /* 不用 overflow:hidden：头部复制胶囊的下拉要能溢出显示；列表自身已裁剪滚动 */
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
  align-items: center;
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
  padding: 12rpx 12rpx;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.06);
  border-radius: 12rpx;
  cursor: pointer;
  transition: background 0.15s;
}
.rank-row:hover { background: rgba(255, 255, 255, 0.07); }
/* 名次徽章：40rpx 圆角方块，前三名金银铜实心，其余冷灰描边 */
.rk-rank {
  flex: 0 0 40rpx;
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
}
.rk-no {
  font-size: 24rpx;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
}
.rank-row.top1 .rk-rank { background: rgba(252, 211, 77, 0.18); border-color: rgba(252, 211, 77, 0.5); }
.rank-row.top1 .rk-no { color: #fcd34d; font-size: 27rpx; }
.rank-row.top2 .rk-rank { background: rgba(226, 232, 240, 0.14); border-color: rgba(226, 232, 240, 0.4); }
.rank-row.top2 .rk-no { color: #e2e8f0; }
.rank-row.top3 .rk-rank { background: rgba(253, 186, 116, 0.16); border-color: rgba(253, 186, 116, 0.45); }
.rank-row.top3 .rk-no { color: #fdba74; }
.rk-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.rk-line1 {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
}
/* 线路号为主：去掉「路」字挤压，数字更大更白；「路」作小字后缀 */
.rk-line {
  font-size: 27rpx;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  white-space: nowrap;
}
.rk-line-unit {
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.4);
  margin-left: -4rpx;
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
  font-size: 19rpx;
  font-weight: 600;
  color: #fcd34d;
  padding-left: 8rpx;
  border-left: 2rpx solid rgba(255, 255, 255, 0.1);
}
/* 次行：走向（弹性省略）· 公司简称 · 时刻，整行单行。完整走向放 title */
.rk-line2 {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
  font-size: 18rpx;
}
.rk-route {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.58);
}
.rk-sep { flex: 0 0 auto; color: rgba(255, 255, 255, 0.22); }
.rk-company {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.38);
  white-space: nowrap;
}
.rk-time { flex: 0 0 auto; color: rgba(255, 255, 255, 0.32); font-variant-numeric: tabular-nums; }
.rk-speed-wrap {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6rpx;
}
/* 快慢用细色条表达（沿地图分档色），数字统一主题高亮：避免榜单顶部一片红字像报警 */
.rk-band {
  flex: 0 0 auto;
  width: 6rpx;
  height: 34rpx;
  border-radius: 3rpx;
  opacity: 0.9;
}
.rk-speed {
  font-size: 38rpx;
  font-weight: 800;
  line-height: 1;
  color: var(--ac-hi);
  font-variant-numeric: tabular-nums;
  min-width: 60rpx;
  text-align: right;
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
