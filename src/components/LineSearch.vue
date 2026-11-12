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
         plain（并入地图左上控制卡）时不设自己的卡壳、不显示状态文案 -->
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
      <!-- 账号胶囊：点开账号窗（内含注销入口）；未登录/会话失效时点击引导重新登录 -->
      <view class="vr-acct" :title="account ? '登录账号：' + account + '，点按查看/注销' : '未登录，点击去登录'" @click="$emit('account')">
        <image v-if="avatar" class="vr-acct-avatar" :src="avatar" mode="aspectFill" />
        <text v-else class="vr-acct-ico">👤</text>
        <text class="vr-acct-t">{{ account || '未登录' }}</text>
      </view>
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
          :placeholder="searchPlaceholder"
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
        <!-- 紧凑单行 + 自适应多列：宽面板一行排 2~3 条，结果再多也不必竖着滚 -->
        <view class="sug-grid">
          <view
            class="sug-item"
            v-for="s in suggestList"
            :key="s.code || s.no"
            :title="sugTitle(s)"
            @click="pickSuggest(s)"
          >
            <image v-if="orgLogo(s)" class="sug-logo" :src="orgLogo(s)" mode="aspectFit" />
            <text class="sug-no">{{ s.no }}</text>
            <text class="sug-route">{{ (s.start || '起点未知') + ' → ' + (s.end || '终点未知') }}</text>
            <FavStar :line="s" small />
            <text class="sug-dot" :class="'sd-' + statusOf(s).key"></text>
          </view>
        </view>
        <view class="sug-foot" v-if="suggestTotal > suggestList.length">
          仅显示前 {{ suggestList.length }} 条 · 继续输入可缩小范围
        </view>
      </view>
      <view class="sug-panel sug-none" v-else-if="suggestEmpty">
        <text class="sug-empty">{{ emptyHint }}</text>
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
import { suggestLines, countMatches, normNo, lineStatus, lineCount as getLineCount, findLine } from '../utils/lineIndex.js'
import { companyOf } from '../utils/companies.js'
import FavStar from './FavStar.vue'

export default {
  name: 'LineSearch',
  components: { FavStar },
  props: {
    // 顶栏视图分段：[{ key, label }]，为空则整行不渲染（详情页可复用本组件的搜索行）
    views: { type: Array, default: () => [] },
    activeView: { type: String, default: '' },
    // 分段行右侧的状态文案（如「337 路 · 更新于 13:34」）
    meta: { type: String, default: '' },
    // 紧凑态：收起品牌行与快捷行，只留分段 + 搜索，把高度让给地图
    compact: { type: Boolean, default: false },
    // 裸形态：宿主已给出卡壳（首页地图视图把它放进 LineMap 的 .ctrl 里）——
    // 自己不再带玻璃背景、不留左右内边距、不重复状态文案
    plain: { type: Boolean, default: false },
    // 当前登录账号（顶栏右侧胶囊展示，点按上抛 account 事件由宿主开账号窗/引导登录）
    account: { type: String, default: '' },
    // 该账号的自定义头像 DataURL（宿主从 avatar.js 取）；空则回退默认人形图标
    avatar: { type: String, default: '' },
    // 当前线路号：顶栏实例与地图态实例是两个不同的组件，冷启动选完线整块换挂载，
    // 若不把宿主的线路号灌进来，搜索框会在切视图那一刻被清空（用户视角是「刚输的没了」）
    lineNoProp: { type: String, default: '' },
    // 全市公交态：搜索框升级为「线路号 / 自编号」通查（自编号找车只在全市快照里有意义）；
    // 其它视图（实时地图/实时线路/线路库）仍只认线路号，文案与提示随之切换
    cityMode: { type: Boolean, default: false },
  },
  emits: ['pick', 'view-change', 'account'],
  data() {
    return {
      lineNo: this.lineNoProp || '',
      // 快捷标签只放营运线路（61 路已停运，点击只会弹「已停运」提示，换成 588）
      quickLines: ['337', '59', '588', '538', '706', '901', '718', '792'],
      // 联想面板开关（点选 / 查询 / 点外部都关闭）
      suggestOpen: false,
    }
  },
  computed: {
    lineCount() {
      return getLineCount()
    },
    logoUrl() {
      return assetUrl('/static/logo.png')
    },
    // 线路库联想（本地 JSON，输入即出；不请求接口）
    // 上限 24：配合多列网格，常见输入基本一屏看全；超出时面板底部提示继续细化
    suggestList() {
      return suggestLines(this.lineNo, 24)
    },
    suggestTotal() {
      return countMatches(this.lineNo)
    },
    // 输入精确命中了停运线路：联想面板已排除停运线，这里单独提示原因，
    // 避免被误读成「库里没收录，仍可查询」（停运线不该再发起实时查询）
    stoppedHit() {
      if (!this.suggestOpen) return null
      if (!normNo(this.lineNo)) return null
      const l = findLine(this.lineNo)
      return l && l.status === '停运' ? l : null
    },
    // 输入了东西但库里没收录（且不是停运线）：提示仍可直接查询，不拦截
    suggestEmpty() {
      return !!this.suggestOpen && !!normNo(this.lineNo) && !this.suggestList.length && !this.stoppedHit
    },
    // 占位与提示按视图切换：只有全市态通查自编号，其余视图仅线路号
    searchPlaceholder() {
      return this.cityMode ? '线路号 / 车辆自编号，如 337 · 3240' : '输入线路号，如 337 / 电1'
    },
    emptyHint() {
      if (this.stoppedHit) {
        const l = this.stoppedHit
        return `「${l.no}路」已停运${l.stopDate ? '（' + l.stopDate + ' 起）' : ''}，可在线路库查看档案`
      }
      return this.cityMode
        ? `线路库未收录「${this.lineNo}」，点「查询」可按自编号找车或直接向后端查一次`
        : `线路库未收录「${this.lineNo}」，点「查询」仍可直接向后端查一次`
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
    orgLogo(s) {
      return assetUrl(companyOf(s).logo)
    },
    orgLabel(s) {
      return companyOf(s).label
    },
    // 紧凑条目把细节收进悬停提示：线路号 + 起讫站 + 公司 + 运行状态
    sugTitle(s) {
      const st = this.statusOf(s)
      return `${s.no} · ${s.start || '起点未知'} → ${s.end || '终点未知'} · ${this.orgLabel(s) || '—'} · ${st.label}`
    },
    // 联想项副标题：武汉公交显「N 站 · 双向」
    sugMeta(s) {
      const dir = s.dirs && s.dirs.length > 1 ? '双向' : '单向'
      const stops = s.stops ? s.stops + ' 站' : '站数未知'
      return stops + ' · ' + dir
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
      const p = this.buildPick(s.code || s.no, s.no, s.start, s.end)
      // 非集团线路带公司归属与静态数据标记，供实时/地图视图跳过无效实时请求
      if (s.companyKey) { p.companyKey = s.companyKey; p.realtime = s.realtime !== false }
      this.$emit('pick', p)
    },
    doSearch() {
      this.suggestOpen = false
      const no = (this.lineNo || '').trim()
      if (!no) {
        uni.showToast({ title: this.cityMode ? '请输入线路号或车辆自编号' : '请输入线路号', icon: 'none' })
        return
      }
      // 已停运线路不再发起实时查询：后端既不会有在运车辆，走向也只是历史档案。
      // 仅拦截手动输入；线路库详情页仍可查看停运线档案。
      const hit = findLine(no)
      if (hit && hit.status === '停运') {
        uni.showToast({ title: `「${hit.no}路」已停运${hit.stopDate ? '（' + hit.stopDate + ' 起）' : ''}`, icon: 'none' })
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
/* 首行右侧不再让位（齿轮已移除），裸形态顶栏整行铺满卡片 */
.mod-main.is-plain .view-row {
  padding-right: 0;
}
/* 裸形态里胶囊跟随放大（头像 46rpx 需要胶囊 ≥46rpx），仍限制宽度避免撑爆 .ctrl */
.mod-main.is-plain .vr-acct {
  height: 52rpx;
  padding: 0 14rpx;
  max-width: 150rpx;
}
.mod-main.is-plain .vr-acct-t {
  font-size: 21rpx;
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
/* 视图分段行：凹槽分段 + 右侧状态文案 */
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
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
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
/* 账号胶囊：分段行右侧，可压缩（账号名出省略号），窄屏不撑爆控制卡 */
.vr-acct {
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  height: 52rpx;
  padding: 0 16rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, transform 0.15s;
}
.vr-acct:hover {
  background: rgba(var(--ac-rgb), 0.16);
  border-color: rgba(var(--ac-rgb), 0.45);
  transform: scale(1.03);
}
.vr-acct-ico {
  flex: 0 0 auto;
  font-size: 22rpx;
  opacity: 0.75;
}
/* 自定义头像：放大到 46rpx，加强调色描边 + 投影，让上传的图在控制卡顶栏成为视觉焦点 */
.vr-acct-avatar {
  flex: 0 0 auto;
  width: 46rpx;
  height: 46rpx;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
  border: 2rpx solid rgba(var(--ac-rgb), 0.55);
  box-shadow: 0 0 0 3rpx rgba(var(--ac-rgb), 0.14), 0 3rpx 10rpx rgba(0, 0, 0, 0.4);
}
.vr-acct-t {
  min-width: 0;
  font-size: 21rpx;
  line-height: 1;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.78);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
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
  /* 上限从 58vh 抬到 72vh：多列网格铺开后，常见输入（≤12 条）已能一屏看全，不必滚 */
  max-height: 72vh;
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
/* 联想条目：紧凑单行 + 自适应多列网格——宽面板一行可放 2~3 条，避免结果多时只能竖着滚 */
.sug-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300rpx, 1fr));
  gap: 10rpx;
  padding: 2rpx 0 4rpx;
}
.sug-item {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
  height: 56rpx;
  padding: 0 14rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s, transform 0.12s;
}
.sug-item:hover {
  background: rgba(34, 211, 238, 0.14);
  border-color: rgba(34, 211, 238, 0.45);
}
.sug-item:active {
  transform: scale(0.97);
}
.sug-logo {
  flex: 0 0 auto;
  width: 28rpx;
  height: 28rpx;
  border-radius: 8rpx;
}
.sug-no {
  flex: 0 0 auto;
  font-size: 23rpx;
  font-weight: 800;
  color: #a5f3fc;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sug-route {
  flex: 1;
  min-width: 0;
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 运行状态色点：营运中（翠绿）/ 已收班（琥珀）/ 已停运（石板灰） */
.sug-dot {
  flex: 0 0 auto;
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
}
.sd-live { background: #34d399; box-shadow: 0 0 8rpx rgba(52, 211, 153, 0.55); }
.sd-ended { background: #fbbf24; }
.sd-off { background: #94a3b8; }
/* 超出上限时的收窄提示 */
.sug-foot {
  padding: 8rpx 14rpx 4rpx;
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.34);
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
