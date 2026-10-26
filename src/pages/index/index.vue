<template>
  <view class="page">
    <!-- 居中主区：无结果时占满视口垂直居中 -->
    <view class="center-zone" :class="{ 'cz-full': !hasResult }">
      <!-- 顶部标题 -->
      <view class="hero">
        <view class="hero-head">
          <image class="hero-logo" :src="logoUrl" mode="aspectFit" />
          <view class="hero-headtext">
            <view class="hero-title">武汉公交信息实时查询</view>
            <view class="hero-sub">在线营运线路 · 站点 · 实时车辆</view>
          </view>
        </view>
      </view>

      <!-- 搜索卡片（毛玻璃） -->
      <view class="search-card glass">
        <text class="search-icon">🔍</text>
        <input
          class="search-input"
          v-model="lineNo"
          type="text"
          placeholder="输入公交线路号，如 337 / 电1"
          placeholder-class="search-ph"
          confirm-type="search"
          @input="onInput"
          @confirm="doSearch"
        />
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
            <text class="sug-go">›</text>
          </view>
        </view>
        <view class="sug-panel sug-none" v-else-if="suggestEmpty">
          <text class="sug-empty">线路库未收录「{{ lineNo }}」，点「查询」仍可直接向后端查一次</text>
        </view>
      </view>

      <!-- 查询按钮（居中） -->
      <view class="search-btn-wrap">
        <view class="search-btn" @click="doSearch">查 询</view>
      </view>

      <!-- 快捷线路 -->
      <view class="quick-wrap">
        <view class="quick-title">快捷查询</view>
        <view class="quick-tags">
          <view
            v-for="item in quickLines"
            :key="item"
            class="quick-tag glass-soft"
            @click="quickSearch(item)"
          >{{ item }}</view>
        </view>
      </view>

      <!-- 地图服务设置（BYOK）：展开式卡片 -->
      <view class="map-cfg glass" v-if="showSettings">
        <view class="mc-head">
          <view class="mc-title">地图服务设置</view>
          <view class="mc-close" @click="showSettings = false">✕</view>
        </view>
        <view class="mc-desc">实时地图使用高德「Web端(JS API)」。填入你自己申请的 Key 后，地图用量计入你的高德账号；留空则使用内置 Key（开发模式）。</view>

        <view class="field">
          <view class="label">地图渲染方式</view>
          <view class="mc-seg">
            <view
              v-for="m in modeOptions"
              :key="m.value"
              class="mc-seg-item"
              :class="{ on: mapMode === m.value }"
              @click="pickMode(m.value)"
            >
              <text class="ms-t">{{ m.label }}</text>
              <text class="ms-d">{{ m.desc }}</text>
            </view>
          </view>
        </view>

        <view class="field">
          <view class="label">高德 JS Key</view>
          <input class="input" v-model="amapKey" type="text" placeholder="32 位小写字母 + 数字" placeholder-class="ph" />
        </view>
        <view class="field">
          <view class="label">安全密钥 securityJsCode</view>
          <input class="input" v-model="amapJsCode" type="text" placeholder="与 Key 配对的安全密钥" placeholder-class="ph" />
        </view>

        <view class="mc-state" v-if="hasCustom">
          <text class="mc-dot"></text>当前已启用自定义 Key：{{ maskedKey }}
        </view>

        <view class="mc-btns">
          <view class="mc-btn primary" @click="saveAmap">保存并重载</view>
          <view class="mc-btn" v-if="hasCustom" @click="clearAmap">清除自定义</view>
        </view>

        <view class="mc-help">
          <view class="mc-help-title">如何获取（约 2 分钟）</view>
          <view class="mc-step">1. 打开高德开放平台控制台 console.amap.com，登录后进入「应用管理 → 我的应用」；</view>
          <view class="mc-step">2. 创建新 Key，「启用平台」选择 <text class="em">Web端(JS API)</text>；</view>
          <view class="mc-step">3. 域名白名单可留空（留空表示不限制来源）；</view>
          <view class="mc-step">4. 把生成的 Key 和配套「安全密钥」复制粘贴到上方，保存后页面会自动重载生效。</view>
        </view>
      </view>
    </view>

    <!-- 搜索结果：线路列表 -->
    <view class="result-list" v-if="lines.length">
      <view
        class="line-card glass"
        v-for="(line, idx) in lines"
        :key="idx"
        @click="goLine(line)"
      >
        <view class="lc-badge">{{ line.lineName }}</view>
        <view class="lc-body">
          <view class="lc-route">
            <text class="route-start">{{ line.startStop }}</text>
            <text class="route-arrow">→</text>
            <text class="route-end">{{ line.endStop }}</text>
            <!-- 所属营运公司（由时刻表车辆编号首位推断）：紧跟走向后方 -->
            <view class="lc-org" v-if="line.companies && line.companies.length">
              <view class="org-tag" v-for="c in line.companies" :key="c.no">
                <text class="org-no">{{ c.no }}</text>
                <text class="org-name">{{ c.label }}</text>
              </view>
            </view>
          </view>
          <view class="lc-meta">
            <text class="chip">首班 {{ line.earlyHour }}</text>
            <text class="chip">末班 {{ line.lastHour }}</text>
            <text class="chip">¥{{ line.price }}</text>
            <text class="chip">{{ line.stopCount }}站</text>
            <text class="chip chip-dir">{{ line.direction === 0 ? '上行' : '下行' }}</text>
          </view>
        </view>
        <view class="lc-arrow">›</view>
      </view>
    </view>

    <!-- 地图服务设置入口（右上角齿轮） -->
    <view class="cfg-fab glass-soft" @click="showSettings = !showSettings" title="地图服务设置">⚙</view>

    <!-- 空状态 -->
    <view class="empty glass" v-if="searched && !loading && !lines.length">
      <view class="empty-icon">🚌</view>
      <view class="empty-text">未查询到「{{ keyword }}」线路信息</view>
      <view class="api-error" v-if="apiError">{{ apiError }}</view>
    </view>

    <!-- 加载中 -->
    <view class="loading" v-if="loading">
      <view class="loading-dot"></view>
      <view class="loading-text">正在查询...</view>
    </view>

    <!-- 联想面板的“点外部关闭”遮罩，必须在页面最外层，否则被卡片背景裁切 -->
    <view class="sug-mask" v-if="suggestOpen" @click="suggestOpen = false"></view>
  </view>
</template>

<script>
import { fetchLine, fetchPlanTime, fetchRealTime, decryptBusId, onBusIdReady } from '../../utils/api.js'
import { buildLineCode, getUserAmapConfig, saveUserAmapConfig, clearUserAmapConfig, getMapMode, saveMapMode } from '../../config.js'
import { assetUrl } from '../../utils/asset.js'
import { suggestLines, countMatches, normNo, LINE_COUNT } from '../../utils/lineIndex.js'

// 渲染方式三档：自动（跟随有无 Key）/ 强制走向图 / 强制原生地图
const MODE_OPTIONS = [
  { value: 'auto', label: '自动', desc: '有 Key 用原生' },
  { value: 'schematic', label: '走向图', desc: '自绘双色分轨' },
  { value: 'native', label: '原生地图', desc: '高德底图' },
]

export default {
  data() {
    return {
      lineNo: '',
      keyword: '',
      lines: [],
      loading: false,
      searched: false,
      apiError: '',
      quickLines: ['337', '59', '61', '538', '706', '901', '718', '792'],
      // 地图服务设置（BYOK）面板
      showSettings: false,
      amapKey: '',
      amapJsCode: '',
      // 搜索联想面板开关（点选 / 查询 / 点外部都关闭）
      suggestOpen: false,
      // 线路库条数（scripts/scan-lines.mjs 生成，运行时0 请求）
      lineCount: LINE_COUNT,
      hasCustom: false,
      mapMode: 'auto',
      modeOptions: MODE_OPTIONS,
    }
  },
  computed: {
    // logo 路径基址感知（子路径部署）
    logoUrl() {
      return assetUrl('/static/logo.png')
    },
    // 已有查询结果（或已搜索过）时，主区不再占满视口，结果紧随其下
    hasResult() {
      return this.searched || this.loading
    },
    maskedKey() {
      const k = this.amapKey
      if (!k || k.length < 10) return k
      return `${k.slice(0, 4)}****${k.slice(-4)}`
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
  onLoad() {
    // 回填已保存的自定义高德 Key
    const c = getUserAmapConfig()
    if (c) {
      this.amapKey = c.key || ''
      this.amapJsCode = c.securityJsCode || ''
      this.hasCustom = true
    }
    this.mapMode = getMapMode()
  },
  methods: {
    // 用户输入即展开联想（不用 watch，避免“点选后设值”又把面板弹回来）
    onInput() {
      this.suggestOpen = true
    },
    pickSuggest(s) {
      this.suggestOpen = false
      this.lineNo = s.no
      this.keyword = s.no
      // 库里的 no 是真实线路号，code 才是后端 lineCode（电1 的 code 是 1001）
      this.searchLine(s.code || s.no, s.no)
    },
    // 触发查询
    doSearch() {
      this.suggestOpen = false
      const no = (this.lineNo || '').trim()
      if (!no) {
        uni.showToast({ title: '请输入线路号', icon: 'none' })
        return
      }
      this.keyword = no
      this.searchLine(no)
    },
    quickSearch(no) {
      this.lineNo = no
      this.searchLine(no)
    },
    // 查询指定线路（上下行两个方向）
    // no 是后端 lineCode 段；label 是展示用的线路号（两者偶尔不同）
    async searchLine(no, label) {
      const shown = label || no
      this.loading = true
      this.searched = true
      this.lines = []
      this.apiError = ''
      try {
        const results = []
        // 上行 / 下行两个方向分别查询
        for (const dir of [0, 1]) {
          const code = buildLineCode(no, dir)
          const data = await fetchLine(code)
          if (data && data.lineDetailBaseDto) {
            const base = data.lineDetailBaseDto
            results.push({
              ...base,
              // 以请求的编码为准（响应中的 direction 字段后端是反的）
              lineCode: code,
              direction: dir,
              stopCount: (data.stopDetailList || []).length,
              // 营运公司徽标：列表渲染后异步附加
              companies: [],
            })
          }
        }
        this.lines = results
        // 不阻塞列表：用时刻表明文车辆编号推断各方向的营运公司
        this.lines.forEach((l) => this.attachCompanies(l))
        if (!results.length) {
          this.keyword = shown
        }
      } catch (e) {
        this.lines = []
        this.keyword = shown
        const msg = (e && e.message) || ''
        if (msg.indexOf('openId') > -1 || msg.indexOf('缺少') > -1) {
          this.apiError = '接口鉴权未配置，请在 src/config.js 填写 openId'
        } else if (msg.indexOf('线路找不到') > -1) {
          this.apiError = `线路「${shown}」不存在，请确认线路号（部分线路号需带前缀）`
        } else {
          this.apiError = `接口返回错误：${msg}`
        }
      } finally {
        this.loading = false
      }
    },
    // 附加营运公司徽标数据：优先用时刻表明文车辆编号（orgBusId）首位推断；
    // 部分方向时刻表后端无数据，回退用实时在线车辆（busId 为 MD5，需字典还原）
    async attachCompanies(line) {
      const cn = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']
      const set = new Set()
      const pick = (id) => {
        const d = String(id || '').charAt(0)
        if (d >= '1' && d <= '9') set.add(Number(d))
      }
      const fill = () => {
        line.companies = [...set]
          .sort((a, b) => a - b)
          .map((no) => ({ no, label: `武汉公交集团${cn[no]}营运公司` }))
      }
      try {
        const plan = await fetchPlanTime(line.lineCode)
        ;(Array.isArray(plan) ? plan : []).forEach((p) => pick(p.orgBusId || p.orgBusNo))
      } catch (e) { /* 忽略，继续尝试实时 */ }
      if (set.size) return fill()
      try {
        const rt = await fetchRealTime(line.lineCode)
        const list = (rt && rt.lineBusDtoList) || []
        // 字典未就绪时等待就绪再还原
        await new Promise((resolve) => {
          onBusIdReady(() => {
            list.forEach((b) => pick(decryptBusId(b.busId) || b.busNo))
            resolve()
          })
        })
      } catch (e) { /* 忽略 */ }
      fill()
    },
    // 渲染方式是页面创建时读一次的（useMap 不响应存储变化），必须整页重载才生效
    pickMode(mode) {
      if (mode === this.mapMode) return
      if (mode === 'native' && !this.hasCustom && !(this.amapKey || '').trim()) {
        uni.showToast({ title: '原生地图需先填写高德 Key', icon: 'none' })
        return
      }
      this.mapMode = mode
      saveMapMode(mode)
      this.reloadAmapCfg()
    },
    // 保存自定义高德 Key：高德 SDK 一经加载无法换 Key，必须整页重载
    saveAmap() {
      const key = (this.amapKey || '').trim()
      const jscode = (this.amapJsCode || '').trim()
      if (!key) {
        uni.showToast({ title: '请输入高德 Key', icon: 'none' })
        return
      }
      saveUserAmapConfig({ key, securityJsCode: jscode })
      this.reloadAmapCfg()
    },
    clearAmap() {
      clearUserAmapConfig()
      this.amapKey = ''
      this.amapJsCode = ''
      this.hasCustom = false
      this.reloadAmapCfg()
    },
    reloadAmapCfg() {
      // #ifdef H5
      uni.showToast({ title: '已保存，正在重载...', icon: 'none' })
      setTimeout(() => window.location.reload(), 400)
      // #endif
      // #ifndef H5
      uni.showToast({ title: 'App 端地图 Key 随安装包内置，无需配置', icon: 'none' })
      // #endif
    },
    // 进入线路详情
    goLine(line) {
      const { lineCode, direction, lineName, startStop, endStop } = line
      uni.navigateTo({
        url: `/pages/line/line?lineCode=${lineCode}&direction=${direction}&lineName=${lineName}&startStop=${startStop}&endStop=${endStop}`,
      })
    },
  },
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx 60rpx;
  box-sizing: border-box;
}
/* 居中主区：水平居中；无结果时撑满视口垂直居中 */
.center-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}
.cz-full {
  min-height: 88vh;
  justify-content: center;
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
/* 标题 */
.hero {
  padding: 24rpx 0 40rpx;
  width: 100%;
  max-width: 860rpx;
}
.hero-head {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4rpx;
}
.hero-logo {
  width: 120rpx;
  height: 120rpx;
  flex-shrink: 0;
  margin-right: 26rpx;
  padding: 14rpx;
  box-sizing: border-box;
  border-radius: 28rpx;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.06));
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 16rpx 40rpx rgba(0, 0, 0, 0.35), inset 0 1rpx 0 rgba(255, 255, 255, 0.25);
}
.hero-headtext {
  flex: 1;
  min-width: 0;
}
.hero-title {
  font-size: 48rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
  line-height: 1.2;
  background: linear-gradient(120deg, #ffffff 0%, #dbe4ff 45%, #a5f3fc 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-sub {
  margin-top: 10rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 2rpx;
}
/* 搜索卡片：兼做联想面板的定位容器（面板浮在“查询”按钮上方，不撑高布局） */
.search-card {
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 860rpx;
  box-sizing: border-box;
  padding: 16rpx 16rpx 16rpx 32rpx;
  position: relative;
  z-index: 42;
  transition: box-shadow 0.25s, border-color 0.25s;
}
.search-card:focus-within {
  border-color: rgba(129, 140, 248, 0.55);
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.42), 0 0 0 4rpx rgba(99, 102, 241, 0.22), inset 0 1rpx 0 rgba(255, 255, 255, 0.20);
}
.search-icon {
  font-size: 30rpx;
  margin-right: 16rpx;
  opacity: 0.7;
}
.search-input {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  color: #fff;
}
.search-ph {
  color: rgba(255, 255, 255, 0.4);
}
/* 线路库联想面板 */
.sug-panel {
  position: absolute;
  top: calc(100% + 12rpx);
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
/* 联想面板的点击外部关闭遮罩（低于搜索卡片 42） */
.sug-mask {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 41;
}
/* 查询按钮：水平居中 */
.search-btn-wrap {
  display: flex;
  justify-content: center;
  margin-top: 36rpx;
}
.search-btn {
  background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #06b6d4);
  color: #fff;
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 8rpx;
  border-radius: 999rpx;
  padding: 0 96rpx;
  height: 88rpx;
  line-height: 88rpx;
  box-shadow: 0 14rpx 34rpx rgba(99, 102, 241, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
  transition: transform 0.15s, box-shadow 0.2s;
}
.search-btn:hover {
  transform: translateY(-4rpx);
  box-shadow: 0 20rpx 44rpx rgba(99, 102, 241, 0.6), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.search-btn:active {
  transform: scale(0.96);
  box-shadow: 0 6rpx 16rpx rgba(99, 102, 241, 0.5);
}
/* 快捷查询 */
.quick-wrap {
  margin-top: 40rpx;
  width: 100%;
  max-width: 860rpx;
}
.quick-title {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 20rpx;
  text-align: center;
}
.quick-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}
.quick-tag {
  padding: 14rpx 34rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 500;
  color: #e5e9ff;
  margin: 0 18rpx 18rpx 0;
  transition: transform 0.18s, background 0.2s, border-color 0.2s;
}
.quick-tag:hover {
  transform: translateY(-4rpx);
  border-color: rgba(129, 140, 248, 0.5);
}
.quick-tag:active {
  transform: scale(0.95);
}
/* 结果卡片 */
.result-list {
  margin-top: 44rpx;
}
.line-card {
  position: relative;
  display: flex;
  align-items: center;
  padding: 30rpx 32rpx;
  margin-bottom: 26rpx;
  overflow: hidden;
  transition: transform 0.22s, box-shadow 0.22s, border-color 0.22s;
}
.line-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 8rpx;
  background: linear-gradient(180deg, #6366f1, #06b6d4);
  opacity: 0.9;
}
.line-card:hover {
  transform: translateY(-6rpx);
  border-color: rgba(129, 140, 248, 0.45);
  box-shadow: 0 30rpx 70rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.20);
}
.line-card:active {
  transform: translateY(-2rpx) scale(0.995);
}
.lc-badge {
  flex-shrink: 0;
  min-width: 100rpx;
  text-align: center;
  font-size: 40rpx;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border-radius: 22rpx;
  padding: 16rpx 18rpx;
  box-shadow: 0 10rpx 28rpx rgba(6, 182, 212, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.35);
}
.lc-body {
  flex: 1;
  min-width: 0;
  margin: 0 24rpx;
}
.lc-route {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 30rpx;
  color: #fff;
  font-weight: 600;
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
/* 营运公司徽标：紧跟走向后方 */
.lc-org {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  margin-left: 16rpx;
}
.org-tag {
  display: inline-flex;
  align-items: center;
  background: rgba(251, 191, 36, 0.12);
  border: 2rpx solid rgba(251, 191, 36, 0.35);
  border-radius: 999rpx;
  padding: 2rpx 18rpx 2rpx 2rpx;
  margin: 4rpx 0 4rpx 12rpx;
  white-space: nowrap;
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
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  box-shadow: 0 4rpx 12rpx rgba(251, 191, 36, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.4);
  margin-right: 10rpx;
  flex-shrink: 0;
}
.org-name {
  font-size: 20rpx;
  color: #fcd34d;
}
.lc-meta {
  display: flex;
  flex-wrap: wrap;
  margin-top: 16rpx;
}
.chip {
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  border-radius: 999rpx;
  padding: 6rpx 20rpx;
  margin: 0 12rpx 10rpx 0;
}
.chip-dir {
  color: #67e8f9;
  background: rgba(6, 182, 212, 0.16);
}
.lc-arrow {
  font-size: 40rpx;
  color: rgba(255, 255, 255, 0.6);
  flex-shrink: 0;
  width: 56rpx;
  height: 56rpx;
  line-height: 52rpx;
  text-align: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  transition: transform 0.2s, background 0.2s;
}
.line-card:hover .lc-arrow {
  background: rgba(129, 140, 248, 0.22);
  transform: translateX(4rpx);
}
/* 空状态 */
.empty {
  margin-top: 60rpx;
  padding: 70rpx 40rpx;
  text-align: center;
}
.empty-icon {
  font-size: 84rpx;
}
.empty-text {
  margin-top: 24rpx;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.65);
}
.api-error {
  margin-top: 20rpx;
  font-size: 24rpx;
  color: #fca5a5;
}
/* 加载 */
.loading {
  margin-top: 70rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.loading-dot {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(255, 255, 255, 0.18);
  border-top-color: #818cf8;
  animation: spin 0.9s linear infinite;
}
.loading-text {
  margin-top: 22rpx;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.6);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
/* ===== 地图服务设置（BYOK）===== */
/* 右上角齿轮入口 */
.cfg-fab {
  position: fixed;
  top: 28rpx;
  right: 28rpx;
  z-index: 20;
  width: 72rpx;
  height: 72rpx;
  line-height: 72rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 36rpx;
  color: rgba(255, 255, 255, 0.8);
  box-shadow: 0 12rpx 32rpx rgba(0, 0, 0, 0.35);
  cursor: pointer;
  transition: transform 0.25s, background 0.2s;
}
.cfg-fab:hover {
  background: rgba(129, 140, 248, 0.28);
  transform: rotate(60deg);
}
/* 展开式设置卡片 */
.map-cfg {
  width: 100%;
  max-width: 860rpx;
  box-sizing: border-box;
  margin-top: 44rpx;
  padding: 36rpx 40rpx;
}
.mc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14rpx;
}
.mc-title {
  font-size: 34rpx;
  font-weight: 800;
  color: #fff;
}
.mc-close {
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.65);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  cursor: pointer;
}
.mc-close:hover {
  background: rgba(255, 255, 255, 0.16);
}
.mc-desc {
  font-size: 24rpx;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 30rpx;
}
.field {
  margin-bottom: 24rpx;
}
/* 渲染方式三档选择（<text> 在 H5 下是 inline，必须显式 block） */
.mc-seg {
  display: flex;
  gap: 12rpx;
}
.mc-seg-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  padding: 16rpx 6rpx;
  box-sizing: border-box;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.mc-seg-item.on {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.35), rgba(6, 182, 212, 0.28));
  border-color: rgba(129, 140, 248, 0.7);
}
.ms-t {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 1.2;
  color: #fff;
}
.ms-d {
  display: block;
  font-size: 19rpx;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
}
.label {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 10rpx;
}
.input {
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  border-radius: 20rpx;
  padding: 18rpx 26rpx;
  font-size: 28rpx;
  color: #fff;
}
.input:focus {
  border-color: rgba(129, 140, 248, 0.55);
}
.ph {
  color: rgba(255, 255, 255, 0.35);
}
.mc-state {
  display: flex;
  align-items: center;
  font-size: 24rpx;
  color: #67e8f9;
  margin: 4rpx 0 24rpx;
}
.mc-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #22d3ee;
  margin-right: 12rpx;
}
.mc-btns {
  display: flex;
  gap: 24rpx;
  margin: 8rpx 0 32rpx;
}
.mc-btn {
  flex: 1;
  text-align: center;
  font-size: 28rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 999rpx;
  padding: 20rpx 0;
  cursor: pointer;
  transition: transform 0.15s, background 0.2s;
}
.mc-btn:active {
  transform: scale(0.97);
}
.mc-btn.primary {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border: none;
  box-shadow: 0 14rpx 34rpx rgba(99, 102, 241, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.mc-help {
  border-top: 2rpx solid rgba(255, 255, 255, 0.1);
  padding-top: 24rpx;
}
.mc-help-title {
  font-size: 26rpx;
  font-weight: 700;
  color: #a5b4fc;
  margin-bottom: 14rpx;
}
.mc-step {
  font-size: 23rpx;
  line-height: 1.9;
  color: rgba(255, 255, 255, 0.55);
}
.em {
  color: #fcd34d;
  font-weight: 600;
}
</style>
