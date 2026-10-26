<template>
  <view class="page">
    <!-- 统一模块栈：所有内容都是“整卡包裹 + 行分块”，与地图页 .ctrl 同一套语言 -->
    <view class="stack">
      <!-- 主控卡：品牌行 / 搜索行 / 快捷行 -->
      <view class="mod mod-main">
        <!-- 品牌行：只放标识与标题，操作键全部下沉到下面的搜索行 -->
        <view class="mod-row brand-row">
          <image class="brand-logo" :src="logoUrl" mode="aspectFit" />
          <view class="brand-text">
            <view class="brand-title">武汉公交信息实时查询</view>
            <view class="brand-sub">在线营运线路 · 站点 · 实时车辆</view>
          </view>
          <text class="brand-count">线路库 {{ lineCount }}</text>
        </view>

        <view class="mod-div"></view>

        <!-- 搜索行：凹槽输入 + 查询 + 设置键，一条水平分块（联想面板挂在这一行下沿） -->
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
          <view
            class="row-btn"
            :class="{ on: showSettings }"
            title="地图服务设置"
            @click="showSettings = !showSettings"
          >⚙</view>
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

        <view class="mod-div"></view>

        <!-- 快捷行：与地图页“视图工具”同款小胶囊，宽屏一行放得下，窄屏自动换行 -->
        <view class="mod-row quick-row">
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

      <!-- 地图服务设置（BYOK）：同一套模块卡语言 -->
      <view class="mod" v-if="showSettings">
        <view class="mod-row mc-head">
          <view class="mc-title">地图服务设置</view>
          <view class="row-btn" @click="showSettings = false">✕</view>
        </view>

        <view class="mod-div"></view>

        <view class="mod-body">
          <view class="mc-desc">实时地图使用高德「Web端(JS API)」原生地图，必须填写你自己申请的 Key 才能启用地图在线查看实时运营车辆。填好后地图用量计入你的高德账号。</view>

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

          <view class="mc-link" @click="applyKey">前往高德开放平台申请 Key ↗</view>

          <view class="mc-help">
            <view class="mc-help-title">如何获取（约 2 分钟）</view>
            <view class="mc-step">1. 打开高德开放平台控制台 console.amap.com，登录后进入「应用管理 → 我的应用」；</view>
            <view class="mc-step">2. 创建新 Key，「启用平台」选择 <text class="em">Web端(JS API)</text>；</view>
            <view class="mc-step">3. 域名白名单可留空（留空表示不限制来源）；</view>
            <view class="mc-step">4. 把生成的 Key 和配套「安全密钥」复制粘贴到上方，保存后页面会自动重载生效。</view>
          </view>
        </view>
      </view>

      <!-- 查询结果：模块卡 + 方向分段 + 行列表 -->
      <view class="mod mod-list" v-if="lines.length">
        <view class="mod-row result-head">
          <!-- 方向分段：与地图页 .ctrl-dir 同款凹槽 + tab -->
          <view class="rh-seg">
            <view class="rh-tab" :class="{ on: dirFilter === 'all' }" @click="dirFilter = 'all'">全部</view>
            <view class="rh-tab up" :class="{ on: dirFilter === 0 }" @click="dirFilter = 0">上行</view>
            <view class="rh-tab down" :class="{ on: dirFilter === 1 }" @click="dirFilter = 1">下行</view>
          </view>
          <text class="rh-s">{{ keyword }} · {{ lines.length }} 个方向</text>
        </view>

        <view class="mod-div"></view>

        <view
          class="line-row"
          v-for="(line, idx) in shownLines"
          :key="idx"
          @click="goLine(line)"
        >
          <view class="lr-badge" :class="line.direction === 0 ? 'up' : 'down'">{{ line.lineName }}</view>
          <view class="lr-body">
            <view class="lr-route">
              <text class="lr-start">{{ line.startStop }}</text>
              <text class="lr-arrow">→</text>
              <text class="lr-end">{{ line.endStop }}</text>
              <text class="st-badge" :class="'st-' + statusOf(line).key">{{ statusOf(line).label }}</text>
              <!-- 所属营运公司（由时刻表车辆编号首位推断）：紧跟走向后方 -->
              <view class="lr-org" v-if="line.companies && line.companies.length">
                <view class="org-tag" v-for="c in line.companies" :key="c.no">
                  <text class="org-no">{{ c.no }}</text>
                  <text class="org-name">{{ c.label }}</text>
                </view>
              </view>
            </view>
            <view class="lr-meta">
              <text class="chip">首班 {{ line.earlyHour }}</text>
              <text class="chip">末班 {{ line.lastHour }}</text>
              <text class="chip">¥{{ line.price }}</text>
              <text class="chip">{{ line.stopCount }}站</text>
              <text class="chip chip-dir" :class="line.direction === 0 ? 'up' : 'down'">{{ line.direction === 0 ? '上行' : '下行' }}</text>
            </view>
          </view>
          <view class="lr-go">›</view>
        </view>
      </view>

      <!-- 空状态 -->
      <view class="mod mod-empty" v-if="searched && !loading && !lines.length">
        <view class="empty-icon">🚌</view>
        <view class="empty-text">未查询到「{{ keyword }}」线路信息</view>
        <view class="api-error" v-if="apiError">{{ apiError }}</view>
      </view>

      <!-- 加载中 -->
      <view class="mod mod-loading" v-if="loading">
        <view class="loading-dot"></view>
        <text class="loading-text">正在查询...</text>
      </view>
    </view>

    <!-- 联想面板的“点外部关闭”遮罩，必须在页面最外层，否则被卡片背景裁切 -->
    <view class="sug-mask" v-if="suggestOpen" @click="suggestOpen = false"></view>
  </view>
</template>

<script>
import { fetchLine, fetchPlanTime, fetchRealTime, decryptBusId, onBusIdReady } from '../../utils/api.js'
import { buildLineCode, getUserAmapConfig, saveUserAmapConfig, clearUserAmapConfig, openExternal, AMAP_CONSOLE_URL } from '../../config.js'
import { assetUrl } from '../../utils/asset.js'
import { suggestLines, countMatches, normNo, lineStatus, LINE_COUNT } from '../../utils/lineIndex.js'

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
      // 结果卡的方向分段：'all' | 0（上行）| 1（下行）
      dirFilter: 'all',
      // 线路库条数（scripts/scan-lines.mjs 生成，运行时0 请求）
      lineCount: LINE_COUNT,
      hasCustom: false,
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
    // 方向分段过滤后的结果行（'all' 时原样返回）
    shownLines() {
      if (this.dirFilter === 'all') return this.lines
      return this.lines.filter((l) => l.direction === this.dirFilter)
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
  },
  methods: {
    // 运行状态徽标：兼容联想项（status/early/last）与后端结果（stopCount/earlyHour/lastHour）
    statusOf(item) {
      return lineStatus(item)
    },
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
      this.keyword = no
      this.searchLine(no)
    },
    // 查询指定线路（上下行两个方向）
    // no 是后端 lineCode 段；label 是展示用的线路号（两者偶尔不同）
    async searchLine(no, label) {
      const shown = label || no
      this.loading = true
      this.searched = true
      this.lines = []
      this.dirFilter = 'all'
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
    // 打开高德开放平台控制台，引导申请 Web端(JS API) Key
    applyKey() {
      openExternal(AMAP_CONSOLE_URL)
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
  padding: 40rpx 32rpx 72rpx;
  box-sizing: border-box;
}
/* 模块栈：统一内容宽度。rpx 在 ≥960px 桌面上按 375 基准缩（1rpx=0.5px），
   所以宽度也用 rpx 定，让卡片与内部字号一起缩，宽屏才不会拉成一条细长条 */
.stack {
  width: 100%;
  max-width: 1320rpx;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
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
/* 主控卡必须压在联想遮罩(41)之上，否则面板会被遮罩盖住 */
.mod-main {
  z-index: 50;
}
/* 结果卡要裁掉行 hover 背景在圆角外的溢出 */
.mod-list {
  overflow: hidden;
}
/* 模块内的行：统一的水平分块 */
.mod-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 26rpx;
  box-sizing: border-box;
}
/* 不是“行”的内容区（BYOK 表单） */
.mod-body {
  padding: 26rpx;
  box-sizing: border-box;
}
/* 细分隔线：行与行之间的模块边界 */
.mod-div {
  height: 2rpx;
  margin: 0 26rpx;
  background: rgba(255, 255, 255, 0.07);
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
/* 右上角线路库总数：品牌行的“数据量”标签，不与操作键争位置 */
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
/* 行内小方键（齿轮 / 关闭）：与地图页 .dir-swap 同一套触感 */
.row-btn {
  flex: 0 0 auto;
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18rpx;
  font-size: 30rpx;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  cursor: pointer;
  transition: background 0.18s, color 0.18s, border-color 0.18s, transform 0.15s;
}
.row-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.row-btn:active {
  transform: scale(0.94);
}
.row-btn.on {
  color: #67e8f9;
  background: rgba(34, 211, 238, 0.16);
  border-color: rgba(34, 211, 238, 0.45);
}
/* 搜索行：兼做联想面板的定位容器（面板浮在这一行下沿，不撑高布局） */
.search-row {
  position: relative;
  z-index: 42;
  padding: 18rpx 22rpx;
  gap: 12rpx;
}
/* 输入凹槽：与地图页 .ctrl-search 同款，输入框是“卡片里的一个槽”，不是自带阴影的独立胶囊 */
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
/* 查询键：与凹槽同高，紧贴其右侧 */
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
/* 搜索行里的齿轮：与凹槽、查询键同高，一排三个控件垂直居中 */
.search-row .row-btn {
  width: 72rpx;
  height: 72rpx;
}
/* 线路库联想面板：直接贴满卡片宽度，看上去像卡片向下展开的一层 */
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
/* 联想面板的点击外部关闭遮罩（低于搜索卡片 42） */
.sug-mask {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 41;
}
/* ---- 快捷行：与地图页“视图工具”同款小胶囊 ---- */
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
/* ---- 结果卡：分段头 + 行列表 ---- */
.result-head {
  padding: 18rpx 22rpx;
  gap: 16rpx;
}
/* 方向分段：与地图页 .ctrl-dir 同款凹槽 + tab */
.rh-seg {
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 6rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  border-radius: 16rpx;
}
.rh-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 52rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  font-size: 24rpx;
  line-height: 1;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.68);
  border-radius: 12rpx;
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.rh-tab:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.10);
}
.rh-tab.on {
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
}
/* 上/下行选中态直接用方向色，与详情页走向线同色 */
.rh-tab.up.on {
  color: #062a33;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
  box-shadow: 0 6rpx 18rpx rgba(6, 182, 212, 0.32);
}
.rh-tab.down.on {
  color: #fff;
  background: linear-gradient(135deg, #fb7185, #e11d48);
  box-shadow: 0 6rpx 18rpx rgba(225, 29, 72, 0.32);
}
.rh-s {
  margin-left: auto;
  font-size: 21rpx;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.42);
}
/* 结果行：一个方向一行，hover 只亮行底、无位移（模块内的行不该浮起来） */
.line-row {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 24rpx 26rpx;
  box-sizing: border-box;
  cursor: pointer;
  transition: background 0.18s;
}
.line-row:hover {
  background: rgba(255, 255, 255, 0.045);
}
.line-row:active {
  background: rgba(255, 255, 255, 0.075);
}
.lr-badge {
  flex: 0 0 auto;
  min-width: 104rpx;
  padding: 14rpx 16rpx;
  box-sizing: border-box;
  text-align: center;
  font-size: 34rpx;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 1rpx;
  font-variant-numeric: tabular-nums;
  color: #fff;
  border-radius: 20rpx;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  box-shadow: 0 10rpx 26rpx rgba(6, 182, 212, 0.32), inset 0 1rpx 0 rgba(255, 255, 255, 0.34);
}
.lr-badge.up {
  color: #062a33;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
}
.lr-badge.down {
  background: linear-gradient(135deg, #fb7185, #e11d48);
  box-shadow: 0 10rpx 26rpx rgba(225, 29, 72, 0.32), inset 0 1rpx 0 rgba(255, 255, 255, 0.34);
}
.lr-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.lr-route {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 27rpx;
  font-weight: 600;
  line-height: 1.45;
  color: #fff;
}
.lr-start, .lr-end {
  white-space: normal;
  word-break: break-all;
}
.lr-arrow {
  margin: 0 12rpx;
  color: rgba(255, 255, 255, 0.42);
}
/* 营运公司徽标：紧跟走向后方 */
.lr-org {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
}
.lr-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}
.lr-go {
  flex: 0 0 auto;
  font-size: 34rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.28);
  transition: transform 0.18s, color 0.18s;
}
.line-row:hover .lr-go {
  color: #fff;
  transform: translateX(4rpx);
}
/* 小信息片：首末班 / 票价 / 站数 / 方向 */
.chip {
  font-size: 20rpx;
  line-height: 1;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
}
.chip-dir.up {
  color: #67e8f9;
  background: rgba(6, 182, 212, 0.18);
  border-color: rgba(34, 211, 238, 0.34);
}
.chip-dir.down {
  color: #fda4af;
  background: rgba(244, 63, 94, 0.18);
  border-color: rgba(251, 113, 133, 0.34);
}
/* 运行状态徽标：营运中（翠绿）/ 已收班（琥珀）/ 已停运（石板灰）
   刻意避开青蓝（上行）/玫红（下行），不与方向色打架 */
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
/* 营运公司徽标（金底圆形编号 + 公司名） */
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
/* 空状态：也是一张模块卡，居中即可 */
.mod-empty {
  padding: 56rpx 40rpx;
  text-align: center;
}
.empty-icon {
  font-size: 76rpx;
  line-height: 1;
}
.empty-text {
  margin-top: 20rpx;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.65);
}
.api-error {
  margin-top: 20rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #fca5a5;
}
/* 加载：一行卡，不再占大块高度 */
.mod-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18rpx;
  padding: 46rpx;
}
.loading-dot {
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(255, 255, 255, 0.18);
  border-top-color: #818cf8;
  animation: spin 0.9s linear infinite;
}
.loading-text {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.6);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
/* ===== 地图服务设置（BYOK）===== */
.mc-head {
  justify-content: space-between;
}
.mc-title {
  font-size: 30rpx;
  font-weight: 800;
  color: #fff;
}
/* 说明文案：表单区顶部的一段灰字 */
.mc-desc {
  font-size: 23rpx;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 26rpx;
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
/* 外部链接按钮：高德开放平台申请 Key */
.mc-link {
  display: block;
  text-align: center;
  font-size: 25rpx;
  font-weight: 600;
  color: #67e8f9;
  background: rgba(34, 211, 238, 0.10);
  border: 2rpx solid rgba(34, 211, 238, 0.32);
  border-radius: 999rpx;
  padding: 18rpx 0;
  margin: -12rpx 0 32rpx;
  cursor: pointer;
  transition: transform 0.15s, background 0.2s;
}
.mc-link:active {
  transform: scale(0.98);
  background: rgba(34, 211, 238, 0.18);
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
