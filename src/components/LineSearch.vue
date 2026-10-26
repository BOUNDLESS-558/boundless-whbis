<template>
  <view class="mod mod-main" :class="{ 'is-plain': plain }">
    <!-- 品牌行：只放标识与标题，操作键全部下沉到下面的搜索行；紧凑态（已选线路）／并入地图控制卡时整行收起 -->
    <view class="mod-row brand-row" v-if="!compact && !plain">
      <image class="brand-logo" :src="logoUrl" mode="aspectFit" />
      <view class="brand-text">
        <view class="brand-title">武汉公交信息实时查询</view>
        <view class="brand-sub">在线营运线路 · 站点 · 实时车辆</view>
      </view>
      <text class="brand-count">线路库 {{ lineCount }}</text>
    </view>

    <view class="mod-div" v-if="!compact && !plain"></view>

    <!-- 视图分段行：切换 实时地图 / 实时线路 / 时刻表 / 线路库。
         分段项由宿主页给（views），本组件只管高亮与上抛，不掺业务状态；
         plain（并入地图左上控制卡）时不设自己的卡壳、不显示状态文案与齿轮（齿轮由 .ctrl-cfg 承担） -->
    <view class="mod-row view-row" v-if="views.length">
      <view class="seg-groove">
        <view
          class="seg-tab"
          v-for="v in views"
          :key="v.key"
          :class="{ on: v.key === activeView }"
          @click="$emit('view-change', v.key)"
        >{{ plain ? (v.short || v.label) : v.label }}</view>
      </view>
      <text class="vr-meta" v-if="meta && !plain">{{ meta }}</text>
      <view class="ab-gear" v-if="!plain" @click="$emit('open-settings')" title="地图服务设置">⚙</view>
    </view>

    <view class="mod-div" v-if="views.length && !plain"></view>

    <!-- 搜索行：凹槽输入 + 查询；联想面板浮在这一行下沿 -->
    <view class="mod-row search-row">
      <view class="search-groove">
        <text class="search-icon">🔍</text>
        <input
          class="search-input"
          v-model="lineNo"
          type="text"
          placeholder="输入线路号，如 337 / 电1"
          placeholder-class="search-ph"
          confirm-type="search"
          @input="onInput"
          @confirm="doSearch"
        />
      </view>
      <view class="search-btn" @click="doSearch">查询</view>
      <!-- 线路库联想：本地匹配输入，点一条直达对应线路（不发试探请求） -->
      <view class="sug-panel" v-if="suggestOpen && suggestList.length">
        <view class="sug-head">
          <text class="sug-head-t">相关线路 {{ suggestTotal }} 条</text>
          <text class="sug-head-s">线路库 {{ lineCount }} 条 · 本地匹配</text>
        </view>
        <view class="sug-item" v-for="s in suggestList" :key="s.no" @click="pickSuggest(s)">
          <text class="sug-no">{{ s.no }}</text>
          <view class="sug-body">
            <text class="sug-route">{{ s.start || '起点未知' }} → {{ s.end || '终点未知' }}</text>
            <text class="sug-meta">{{ s.stops ? s.stops + ' 站' : '站数未知' }} · {{ s.dirs.length > 1 ? '双向' : '单向' }}</text>
          </view>
          <text class="st-badge" :class="'st-' + statusOf(s).key">{{ statusOf(s).label }}</text>
          <text class="sug-go">›</text>
        </view>
      </view>
      <view class="sug-panel sug-none" v-else-if="suggestEmpty">
        <text class="sug-empty">线路库未收录「{{ lineNo }}」，点「查询」仍可直接向后端查一次</text>
      </view>
    </view>

    <view class="mod-div" v-if="!compact && !plain"></view>

    <!-- 快捷行：与地图页“视图工具”同款小胶囊（冷启动时才占位，选线后收起给主视图让高） -->
    <view class="mod-row quick-row" v-if="!compact && !plain">
      <text class="quick-label">快捷</text>
      <view class="quick-tags">
        <view
          v-for="item in quickLines"
          :key="item"
          class="quick-tag"
          @click="quickSearch(item)"
        >{{ item }}</view>
      </view>
    </view>
  </view>
</template>

<script>
import { buildLineCode } from '../config.js'
import { assetUrl } from '../utils/asset.js'
import { suggestLines, countMatches, normNo, lineStatus, LINE_COUNT } from '../utils/lineIndex.js'

export default {
  name: 'LineSearch',
  props: {
    // 顶栏视图分段：[{ key, label }]，为空则整行不渲染（详情页可复用本组件的搜索行）
    views: { type: Array, default: () => [] },
    activeView: { type: String, default: '' },
    // 分段行右侧的状态文案（如「337 路 · 更新于 13:34」）
    meta: { type: String, default: '' },
    // 紧凑态：收起品牌行与快捷行，只留分段 + 搜索，把高度让给地图
    compact: { type: Boolean, default: false },
    // 裸形态：宿主已给出卡壳（首页地图视图把它放进 LineMap 的 .ctrl 里）——
    // 自己不再带玻璃背景、不留左右内边距、不重复状态文案与齿轮
    plain: { type: Boolean, default: false },
    // 当前线路号：顶栏实例与地图态实例是两个不同的组件，冷启动选完线整块换挂载，
    // 若不把宿主的线路号灌进来，搜索框会在切视图那一刻被清空（用户视角是「刚输的没了」）
    lineNoProp: { type: String, default: '' },
  },
  emits: ['pick', 'view-change', 'open-settings'],
  data() {
    return {
      lineNo: this.lineNoProp || '',
      quickLines: ['337', '59', '61', '538', '706', '901', '718', '792'],
      // 联想面板开关（点选 / 查询 / 点外部都关闭）
      suggestOpen: false,
      lineCount: LINE_COUNT,
    }
  },
  computed: {
    logoUrl() {
      return assetUrl('/static/logo.png')
    },
    // 线路库联想（本地 JSON，输入即出；不请求接口）
    suggestList() {
      return suggestLines(this.lineNo, 6)
    },
    suggestTotal() {
      return countMatches(this.lineNo)
    },
    // 输入了东西但库里没收录：提示仍可直接查询，不拦截
    suggestEmpty() {
      return !!this.suggestOpen && !!normNo(this.lineNo) && !this.suggestList.length
    },
  },
  watch: {
    // 宿主换线（选线 / 联想点选 / URL 进页）时同步进搜索框；用户手输不回抛，避免来回抖动
    lineNoProp(v) {
      this.lineNo = v || ''
      this.suggestOpen = false
    },
  },
  methods: {
    // 运行状态徽标：兼容联想项（status/early/last）
    statusOf(item) {
      return lineStatus(item)
    },
    // 用户输入即展开联想（不用 watch，避免“点选后设值”又把面板弹回来）
    onInput() {
      this.suggestOpen = true
    },
    // 拼装选线对象，上抛给宿主页（line 页去拉取详情）
    buildPick(no, label, start, end) {
      return {
        lineCode: (no && String(no).includes('-')) ? no : buildLineCode(no, 0),
        lineName: label || no,
        direction: 0,
        startStop: start || '',
        endStop: end || '',
      }
    },
    pickSuggest(s) {
      this.suggestOpen = false
      this.lineNo = s.no
      // 库里的 no 是真实线路号，code 才是后端 lineCode（电1 的 code 是 1001）
      this.$emit('pick', this.buildPick(s.code || s.no, s.no, s.start, s.end))
    },
    doSearch() {
      this.suggestOpen = false
      const no = (this.lineNo || '').trim()
      if (!no) {
        uni.showToast({ title: '请输入线路号', icon: 'none' })
        return
      }
      this.$emit('pick', this.buildPick(no, no))
    },
    quickSearch(no) {
      this.lineNo = no
      this.$emit('pick', this.buildPick(no, no))
    },
  },
}
</script>

<style scoped>
/* 模块卡：整卡包裹（背景/圆角/描边/阴影），内部只靠 .mod-row + .mod-div 分块 */
.mod {
  position: relative;
  box-sizing: border-box;
  border-radius: 28rpx;
  background: rgba(17, 22, 33, 0.86);
  backdrop-filter: blur(30px) saturate(170%);
  -webkit-backdrop-filter: blur(30px) saturate(170%);
  border: 2rpx solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 26rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.08);
}
/* 主控卡必须压在联想遮罩之上，否则面板会被遮罩盖住 */
.mod-main {
  z-index: 50;
}
.mod-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 26rpx;
  box-sizing: border-box;
}
.mod-div {
  height: 2rpx;
  margin: 0 26rpx;
  background: rgba(255, 255, 255, 0.07);
}
/* ---- 裸形态（并入 LineMap 左上控制卡 .ctrl）----
   卡壳、描边、阴影、毛玻璃都是宿主那张卡的事，这里只交出行（凹槽分段 + 搜索凹槽），
   行高收到与 .ctrl 其余行一致（52rpx），否则一张卡里两种节奏会更像“两张卡叠在一起” */
.mod-main.is-plain {
  /* 行间距靠 flex gap（.mod 默认是 block，光写 gap 不生效） */
  display: flex;
  flex-direction: column;
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
  gap: 10rpx;
  min-width: 0;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.mod-main.is-plain .mod-row {
  padding: 0;
}
/* 首行右侧让位给 .ctrl 右上角绝对定位的齿轮（与 .ctrl-search 同一口径） */
.mod-main.is-plain .view-row {
  padding-right: 72rpx;
}
.mod-main.is-plain .seg-tab {
  height: 48rpx;
  padding: 0 10rpx;
  font-size: 23rpx;
}
.mod-main.is-plain .search-groove {
  height: 52rpx;
  padding: 0 14rpx;
  border-radius: 14rpx;
}
.mod-main.is-plain .search-icon {
  font-size: 24rpx;
}
.mod-main.is-plain .search-input {
  height: 48rpx;
  line-height: 48rpx;
  font-size: 26rpx;
}
.mod-main.is-plain .search-btn {
  height: 52rpx;
  line-height: 52rpx;
  padding: 0 22rpx;
  letter-spacing: 0;
  font-size: 24rpx;
  border-radius: 14rpx;
}
.mod-main.is-plain .sug-panel {
  /* 贴在搜索行下沿，宽度取整张控制卡（左侧不再内缩），看起来像卡片向下展开一层 */
  left: -12rpx;
  right: -12rpx;
}
/* ---- 品牌行 ---- */
.brand-row {
  padding: 26rpx 26rpx 22rpx;
}
.brand-logo {
  width: 92rpx;
  height: 92rpx;
  flex-shrink: 0;
  padding: 10rpx;
  box-sizing: border-box;
  border-radius: 22rpx;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.06));
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 12rpx 30rpx rgba(0, 0, 0, 0.32), inset 0 1rpx 0 rgba(255, 255, 255, 0.22);
}
.brand-text {
  flex: 1;
  min-width: 0;
}
.brand-title {
  font-size: 38rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(120deg, #ffffff 0%, #dbe4ff 45%, #a5f3fc 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.brand-sub {
  margin-top: 8rpx;
  font-size: 22rpx;
  letter-spacing: 1rpx;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 右上角线路库总数：品牌行的“数据量”标签 */
.brand-count {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.09);
}
/* 视图分段行：凹槽分段 + 右侧状态文案 + 齿轮（齿轮复用顶栏同款类名，全站一个视觉语言） */
.view-row {
  padding: 16rpx 22rpx;
  gap: 16rpx;
}
.seg-groove {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 6rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  border-radius: 16rpx;
}
.seg-tab {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 52rpx;
  padding: 0 14rpx;
  box-sizing: border-box;
  font-size: 24rpx;
  line-height: 1;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.68);
  border-radius: 12rpx;
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.seg-tab:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.10);
}
.seg-tab.on {
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
}
.vr-meta {
  flex: 0 0 auto;
  max-width: 30%;
  font-size: 20rpx;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.42);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ab-gear {
  flex: 0 0 auto;
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  cursor: pointer;
  transition: background 0.18s, color 0.18s, border-color 0.18s, transform 0.15s;
}
.ab-gear:hover {
  background: rgba(129, 140, 248, 0.16);
  color: #fff;
  border-color: rgba(129, 140, 248, 0.45);
}
.ab-gear:active {
  transform: scale(0.94);
}
/* 搜索行：兼做联想面板的定位容器（面板浮在这一行下沿，不撑高布局） */
.search-row {
  position: relative;
  z-index: 42;
  padding: 18rpx 22rpx;
  gap: 12rpx;
}
.search-groove {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 72rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  border-radius: 18rpx;
  transition: background 0.2s, border-color 0.2s;
}
.search-groove:focus-within {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(34, 211, 238, 0.45);
}
.search-icon {
  flex: 0 0 auto;
  font-size: 26rpx;
  opacity: 0.7;
}
.search-input {
  flex: 1;
  min-width: 0;
  height: 68rpx;
  line-height: 68rpx;
  font-size: 28rpx;
  color: #fff;
}
.search-ph {
  color: rgba(255, 255, 255, 0.35);
}
.search-btn {
  flex: 0 0 auto;
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 32rpx;
  border-radius: 18rpx;
  font-size: 26rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  box-shadow: 0 10rpx 26rpx rgba(79, 110, 247, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.2s, filter 0.2s;
}
.search-btn:hover {
  filter: brightness(1.08);
  box-shadow: 0 14rpx 32rpx rgba(79, 110, 247, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.search-btn:active {
  transform: scale(0.96);
}
/* 联想面板：直接贴满卡片宽度，看上去像卡片向下展开的一层 */
.sug-panel {
  position: absolute;
  top: calc(100% + 6rpx);
  left: 0;
  right: 0;
  z-index: 43;
  padding: 10rpx;
  border-radius: 26rpx;
  background: rgba(12, 18, 36, 0.96);
  backdrop-filter: blur(26px) saturate(170%);
  -webkit-backdrop-filter: blur(26px) saturate(170%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 24rpx 56rpx rgba(0, 0, 0, 0.55), inset 0 1rpx 0 rgba(255, 255, 255, 0.12);
  max-height: 58vh;
  overflow-y: auto;
}
.sug-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
  padding: 8rpx 14rpx 12rpx;
}
.sug-head-t {
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.58);
}
.sug-head-s {
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.32);
}
.sug-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 14rpx;
  border-radius: 18rpx;
  cursor: pointer;
  transition: background 0.16s;
}
.sug-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.sug-no {
  flex: 0 0 auto;
  min-width: 92rpx;
  text-align: center;
  padding: 6rpx 14rpx;
  border-radius: 12rpx;
  font-size: 24rpx;
  font-weight: 800;
  color: #062a33;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
  font-variant-numeric: tabular-nums;
}
.sug-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.sug-route {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.86);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sug-meta {
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.4);
}
.sug-go {
  color: rgba(255, 255, 255, 0.3);
  font-size: 26rpx;
}
.sug-none {
  padding: 0;
}
.sug-empty {
  display: block;
  padding: 22rpx 18rpx;
  font-size: 21rpx;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.5);
}
/* 快捷行 */
.quick-row {
  padding: 16rpx 22rpx 20rpx;
  gap: 16rpx;
}
.quick-label {
  flex: 0 0 auto;
  font-size: 22rpx;
  letter-spacing: 1rpx;
  color: rgba(255, 255, 255, 0.38);
}
.quick-tags {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.quick-tag {
  height: 56rpx;
  line-height: 56rpx;
  padding: 0 22rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  transition: background 0.18s, border-color 0.18s, color 0.18s, transform 0.15s;
}
.quick-tag:hover {
  color: #fff;
  background: rgba(34, 211, 238, 0.16);
  border-color: rgba(34, 211, 238, 0.45);
}
.quick-tag:active {
  transform: scale(0.95);
}
/* 运行状态徽标：营运中（翠绿）/ 已收班（琥珀）/ 已停运（石板灰），避开上下行方向色 */
.st-badge {
  flex: 0 0 auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  height: 34rpx;
  padding: 0 14rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  font-size: 19rpx;
  line-height: 1;
  white-space: nowrap;
  font-weight: 700;
  border: 2rpx solid transparent;
}
.st-live {
  color: #34d399;
  background: rgba(16, 185, 129, 0.16);
  border-color: rgba(52, 211, 153, 0.42);
}
.st-ended {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(251, 191, 36, 0.38);
}
.st-off {
  color: #94a3b8;
  background: rgba(100, 116, 139, 0.16);
  border-color: rgba(148, 163, 184, 0.34);
}
</style>
