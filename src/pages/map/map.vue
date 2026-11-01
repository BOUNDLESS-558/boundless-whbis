<template>
  <view class="home" :class="{ 'home--map': mapMount }">
    <!-- 未选线路且不在全市态：地图没有走向可画，此时顶栏是独立玻璃卡，主视图整屏留给线路库当落地页 -->
    <view class="home-top" v-if="!mapMount">
      <LineSearch
        :views="views"
        :active-view="view"
        :meta="metaText"
        :line-no-prop="lineName || lineNo"
        :account="dispName || account"
        :avatar="avatar"
        :city-mode="view === 'city'"
        @pick="onPickLine"
        @view-change="switchView"
        @account="onAccount"
      />
    </view>

    <view class="home-stage" :class="'stage-' + (mapMount ? 'map' : view)">
      <!-- 地图是常驻底座：选了线路（或进入全市公交）就整屏铺满，实时线路 / 线路库都以悬浮窗浮在它上面 -->
      <LineMap
        v-if="mapMount"
        ref="mapC"
        :line-code-prop="lineCode"
        :line-name-prop="lineName"
        :init-direction="direction"
        :city-mode="view === 'city'"
        :embedded="true"
        :fs-enabled="false"
        :data-source-prop="lineSource"
        :hq-line-id-prop="hqLineId"
        @pick-line="onPickLine"
        @exit-city="onExitCity"
      >
        <!-- 裸形态顶栏：视图分段 + 搜索联想并入地图左上控制卡 .ctrl，不再浮在地图外面 -->
        <template #top>
          <LineSearch
            plain
            :views="views"
            :active-view="view"
            :line-no-prop="lineName || lineNo"
            :account="dispName || account"
            :avatar="avatar"
            :city-mode="view === 'city'"
            @pick="onPickLine"
            @view-change="switchView"
            @account="onAccount"
          />
        </template>
      </LineMap>

      <!-- 实时线路：不整屏换页，改为地图上的可拖动悬浮窗（与车辆详情窗同一套交互） -->
      <FloatWin
        v-if="hasLine && view === 'stops'"
        :title="'实时线路 · ' + (lineName || lineNo) + ' 路'"
        sub="站点 · 在线车辆 · 营运信息"
        :width-rpx="1120"
        max-height="76vh"
        resize-key="stops"
        @close="view = 'map'"
      >
        <LineStops
          ref="stopsC"
          plain
          :line-no="lineNo"
          :line-name="lineName"
          :direction="direction"
          :start-stop="startStop"
          :end-stop="endStop"
          @set-dir="onSetDir"
        />
      </FloatWin>

      <!-- 线路库：同样只在地图里开一扇窗，点一条直达该线路（窗宽留足汉奇长线路名 + 起讫站） -->
      <FloatWin
        v-else-if="hasLine && view === 'db'"
        title="线路库"
        sub="本地全量摘要 · 点一条直达"
        :width-rpx="1200"
        max-height="78vh"
        resize-key="db"
        @close="view = 'map'"
      >
        <LineDb plain @pick="onPickLine" />
      </FloatWin>

      <!-- 账号与设置窗：登录身份（头像/用户名）+ 登录有效期 + 全局默认刷新 + 皮肤 + 注销入口。
           注销二次确认在窗内切态完成，不用 uni.showModal（白底系统框与全局玻璃风不符，同激活弹窗的否决理由） -->
      <FloatWin
        v-if="accountShow"
        title="账号与设置"
        sub="本地账号 · 仅存本机"
        :width-rpx="720"
        max-height="72vh"
        resize-key="account"
        @close="accountShow = false"
      >
        <view class="acct" v-if="!acctConfirm">
          <!-- 身份区：头像（可换）+ 用户名（可改）+ 账号名（只读） -->
          <view class="acct-id">
            <view class="acct-avatar" :title="avatar ? '点头像更换头像' : '点设置头像'" @click="onChangeAvatar">
              <image v-if="avatar" class="acct-avatar-img" :src="avatar" mode="aspectFill" />
              <text v-else class="acct-avatar-txt">{{ avatarLetter }}</text>
              <view class="acct-avatar-cam">📷</view>
            </view>
            <view class="acct-id-main">
              <view class="acct-name-row">
                <input
                  class="acct-name-input"
                  v-model="setName"
                  type="text"
                  maxlength="16"
                  placeholder="设置用户名"
                  placeholder-class="acct-name-ph"
                  @confirm="saveName"
                />
                <view class="acct-name-save" @click="saveName">保存</view>
              </view>
              <view class="acct-id-sub">账号 {{ account }} · 不可修改</view>
            </view>
          </view>
          <view class="acct-avatar-ops">
            <view class="acct-mini" @click="onChangeAvatar">更换头像</view>
            <view class="acct-mini" v-if="avatar" @click="onResetAvatar">恢复默认</view>
            <text class="acct-mini-hint">PNG / JPG / JPEG，自动压缩，可多次更换</text>
          </view>

          <view class="acct-div"></view>

          <!-- 登录有效期 -->
          <view class="acct-sec-title">登录有效期</view>
          <view class="acct-seg">
            <view
              class="acct-seg-item"
              v-for="o in sessionOpts"
              :key="o.days"
              :class="{ on: sessionDays === o.days }"
              @click="onSessionDays(o.days)"
            >{{ o.label }}</view>
          </view>
          <view class="acct-row">
            <text class="acct-label">登录状态</text>
            <text class="acct-value ok">{{ sessionExpText }}</text>
          </view>

          <view class="acct-div"></view>

          <!-- 登录密码：预置口令可改为本机自定义密码（只存哈希；改密 / 恢复均需验当前密码） -->
          <view class="acct-sec-title">登录密码</view>
          <view class="acct-tip">{{ pwdCustom ? '已设置自定义密码，下次登录用新密码；也可恢复为预置口令' : '当前用预置口令登录，可修改为自己的密码（仅存本机哈希）' }}</view>
          <input class="acct-name-input acct-pwd-input" v-model="pwdOld" :password="!pwdShow" type="text" placeholder="当前密码" placeholder-class="acct-name-ph" />
          <input class="acct-name-input acct-pwd-input" v-model="pwdNew" :password="!pwdShow" type="text" placeholder="新密码（6~32 位）" placeholder-class="acct-name-ph" />
          <input class="acct-name-input acct-pwd-input" v-model="pwdConfirm" :password="!pwdShow" type="text" placeholder="确认新密码" placeholder-class="acct-name-ph" @confirm="onChangePwd" />
          <view class="acct-pwd-ops">
            <view class="acct-mini" @click="pwdShow = !pwdShow">{{ pwdShow ? '隐藏' : '显示' }}密码</view>
          </view>
          <view class="acct-btns">
            <view class="acct-btn ghost" v-if="pwdCustom" @click="onResetPwd">恢复默认口令</view>
            <view class="acct-btn save" @click="onChangePwd">修改密码</view>
          </view>

          <view class="acct-div"></view>

          <!-- 全局默认刷新间隔 -->
          <view class="acct-sec-title">全局默认刷新间隔</view>
          <view class="acct-seg">
            <view
              class="acct-seg-item"
              v-for="s in refreshOpts"
              :key="s"
              :class="{ on: refreshDefault === s }"
              @click="onRefreshDefault(s)"
            >{{ s === 0 ? '手动' : s + ' 秒' }}</view>
          </view>
          <view class="acct-tip">实时线路 / 实时车辆未手动选过间隔时采用该默认值，改完即时生效</view>

          <view class="acct-div"></view>

          <!-- 皮肤 -->
          <view class="acct-sec-title">皮肤</view>
          <view class="acct-seg">
            <view
              class="acct-seg-item"
              v-for="o in skinOpts"
              :key="o.key"
              :class="{ on: skin === o.key }"
              @click="onSkin(o.key)"
            >{{ o.label }}</view>
          </view>

          <view class="acct-div"></view>

          <!-- 地图来源：自绘走向图底图瓦片源（高德 / 腾讯） -->
          <view class="acct-sec-title">地图来源</view>
          <view class="acct-seg">
            <view
              class="acct-seg-item"
              v-for="o in mapSourceOpts"
              :key="o.key"
              :class="{ on: mapSource === o.key }"
              @click="onMapSource(o.key)"
            >{{ o.label }}</view>
          </view>
          <view class="acct-tip">底图瓦片源，线路走向 / 车辆 / 站点不受影响，改完即时生效</view>

          <view class="acct-tip">注销后回到登录页，本机账号保留，下次可直接登录</view>
          <view class="acct-logout" @click="acctConfirm = true">注销登录</view>
        </view>
        <view class="acct" v-else>
          <view class="acct-q">确定退出账号「{{ dispName || account }}」吗？</view>
          <view class="acct-btns">
            <view class="acct-btn ghost" @click="acctConfirm = false">取消</view>
            <view class="acct-btn main" @click="onLogout">注销</view>
          </view>
        </view>
      </FloatWin>

      <!-- 未选线路时的整屏线路库（全市公交视图自己铺满，不走这里） -->
      <view v-if="!mapMount" class="home-scroll">
        <view class="home-inner">
          <LineDb @pick="onPickLine" />
        </view>
      </view>
    </view>

    <!-- 全市公交激活弹窗：替代系统 showModal（白底样式与全局不符），与玻璃卡同一套视觉 -->
    <view class="act-mask" v-if="actShow" @click.self="actClose">
      <view class="act-card">
        <view class="act-title">激活全市公交</view>
        <view class="act-desc">输入激活码后开启，激活一次长期有效</view>
        <view class="act-groove">
          <input
            class="act-input"
            v-model="actCode"
            type="text"
            placeholder="请输入激活码"
            placeholder-class="act-ph"
            confirm-type="done"
            :focus="actShow"
            @confirm="actConfirm"
          />
        </view>
        <view class="act-btns">
          <view class="act-btn ghost" @click="actClose">取消</view>
          <view class="act-btn main" @click="actConfirm">激活</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import LineMap from '../../components/LineMap.vue'
import LineSearch from '../../components/LineSearch.vue'
import LineStops from '../../components/LineStops.vue'
import LineDb from '../../components/LineDb.vue'
import FloatWin from '../../components/FloatWin.vue'
import { buildLineCode } from '../../config.js'
import { requireLogin, currentAccount, logout, getSessionInfo, hasCustomPass, changePassword, resetPassword } from '../../utils/auth.js'
import {
  SKIN_OPTS,
  REFRESH_DEFAULT_OPTS,
  MAP_SOURCE_OPTS,
  getSkin,
  setSkin,
  getRefreshDefault,
  setRefreshDefault,
  getMapSource,
  setMapSource,
  getDisplayName,
  setDisplayName,
  getSessionDays,
  setSessionDays,
} from '../../utils/settings.js'
import { getAvatar, removeAvatar, pickAvatar } from '../../utils/avatar.js'

// 上次查过的线路：下次进来直接落在地图上，省掉「每次都要搜一遍」
const HOME_LINE_KEY = 'whbis:home-line'
// 视图档位：地图是底座，city 是同一张地图的另一种内容，stops / db 是浮在它上面的两扇窗
const VIEW_KEYS = ['map', 'city', 'stops', 'db']
// 没选线路时不可达的档位（无线路 = 无单条线路可画）；city 不在内：全市线网不依赖选线
const LINE_VIEWS = ['map', 'stops']
// 全市公交激活：输入正确激活码后持久化，之后免再激活
const CITY_ACT_KEY = 'whbis:city-activated'
const CITY_ACT_CODE = 'BOUNDLESS_558'

export default {
  name: 'HomePage',
  components: { LineMap, LineSearch, LineStops, LineDb, FloatWin },
  data() {
    return {
      view: 'db',
      // 登录账号（顶栏账号胶囊展示）与账号窗开关；acctConfirm = 窗内注销二次确认态
      account: '',
      accountShow: false,
      acctConfirm: false,
      // 用户名（展示名，可改）与头像（DataURL，'' = 用默认）；setName 是窗内输入缓冲
      dispName: '',
      avatar: '',
      setName: '',
      // 设置面板：皮肤 / 全局默认刷新 / 登录有效期 / 会话到期文案
      skin: 'dark',
      refreshDefault: 15,
      sessionDays: 30,
      sessionExpText: '',
      // 登录密码修改：窗内输入缓冲 + 是否已自定义 + 明文可见开关
      pwdOld: '',
      pwdNew: '',
      pwdConfirm: '',
      pwdShow: false,
      pwdCustom: false,
      skinOpts: SKIN_OPTS,
      refreshOpts: REFRESH_DEFAULT_OPTS,
      // 地图来源：自绘走向图底图瓦片源
      mapSource: 'amap',
      mapSourceOpts: MAP_SOURCE_OPTS,
      sessionOpts: [
        { days: 7, label: '7 天' },
        { days: 15, label: '15 天' },
        { days: 30, label: '30 天' },
        { days: 0, label: '永不过期' },
      ],
      // 全市公交激活弹窗
      actShow: false,
      actCode: '',
      lineCode: '',
      lineName: '',
      lineNo: '',
      direction: 0,
      startStop: '',
      endStop: '',
      // 数据源：whbus（武汉公交，默认）/ hanqi（汉奇智慧出行）
      lineSource: 'whbus',
      // 汉奇线路 ID（lineSource === 'hanqi' 时透传给 LineMap）
      hqLineId: '',
      // 分段四档一律用全名（悬浮窗时代，「线路 / 线路库」这种短名反而看不懂）
      views: [
        { key: 'map', label: '实时地图' },
        { key: 'city', label: '全市公交' },
        { key: 'stops', label: '实时线路' },
        { key: 'db', label: '线路库' },
      ],
    }
  },
  computed: {
    // 地图底座的唯一判据：有没有线路（不要在这里再掺 view）
    hasLine() {
      return !!this.lineNo
    },
    // 地图要不要挂载：选了线路，或进入不依赖选线的全市公交视图
    mapMount() {
      return this.hasLine || this.view === 'city'
    },
    metaText() {
      if (!this.lineNo) return ''
      return `${this.lineName || this.lineNo} 路 · ${this.direction === 1 ? '下行' : '上行'}`
    },
    // 默认头像：用户名 / 账号名的首字母色块
    avatarLetter() {
      return (this.dispName || this.account || '·').trim().charAt(0).toUpperCase()
    },
  },
  onLoad(query) {
    // 登录守卫：未登录一律回登录页（pages.json 首页已指向 login，这里兜底深链/回退）
    if (!requireLogin()) return
    this.account = currentAccount()
    const q = query || {}
    if (q.lineCode) {
      this.applyPick({
        lineCode: q.lineCode,
        lineName: q.lineName || '',
        direction: Number(q.direction || 0),
        startStop: q.startStop || '',
        endStop: q.endStop || '',
      })
    } else {
      this.restore()
    }
    // URL 指定的档位优先（探针与外部跳转用它落在指定视图）；未选线路时只认全市公交与线路库
    // 全市公交需激活：未激活不进入，保持落地页 / 地图
    const v = q.view
    if (v && VIEW_KEYS.includes(v)) {
      if (v === 'city' && !this.isCityActivated()) {
        if (this.hasLine) this.view = 'map'
      } else if (v === 'stops' && this.lineSource === 'hanqi') {
        // 汉奇线没有武汉公交时刻表/站点接口，实时线路窗拉不到数据，落在地图
        this.view = 'map'
      } else {
        this.view = !this.hasLine && LINE_VIEWS.includes(v) ? 'db' : v
      }
    } else if (this.hasLine) {
      this.view = 'map'
    }
  },
  onShow() {
    // 组件不触发页面生命周期：自动刷新定时器统一由宿主转发（只在 onLoad 建会叠出多个）
    this.fire(['onShow', 'restartAutoRefresh'])
    // 从登录页回来（守卫重定向后 reLaunch 回本页可能不触发 onLoad）时补账号
    if (!this.account) this.account = currentAccount()
    // 胶囊上的用户名 / 头像要常驻，不止开面板时才加载
    if (this.account) this.syncIdentity()
  },
  onHide() {
    this.fire(['onHide', 'stopAutoRefresh'])
  },
  onUnload() {
    this.fire(['cleanup', 'stopAutoRefresh'])
  },
  methods: {
    // 依次尝试调用子组件上的这几个方法（有第一个就用第一个）
    fire(names) {
      ;['mapC', 'stopsC'].forEach((key) => {
        const c = this.$refs[key]
        if (!c) return
        for (const n of names) {
          if (typeof c[n] === 'function') {
            c[n]()
            break
          }
        }
      })
    },
    // 选线：lineCode 形如 {cityCode}-{线路号}-{方向}，线路号由它反解
    applyPick(p) {
      const src = p.source || 'whbus'
      this.lineSource = src
      if (src === 'hanqi') {
        // 汉奇线路：用 lineId 作查询键，lineName 用于展示
        this.hqLineId = p.lineId || ''
        this.lineCode = 'hanqi-' + this.hqLineId
        this.lineNo = p.lineName || ''
        this.lineName = p.lineName || ''
      } else {
        this.hqLineId = ''
        const code = p.lineCode || buildLineCode(p.lineName || p.lineNo || '', p.direction || 0)
        const no = String(code).split('-')[1] || p.lineName || ''
        this.lineCode = code
        this.lineNo = no
        this.lineName = p.lineName || no
      }
      this.direction = Number(p.direction || 0)
      this.startStop = p.startStop || ''
      this.endStop = p.endStop || ''
    },
    // 顶栏搜索与线路库窗共用的选线出口
    onPickLine(p) {
      // 全市公交态：顶栏搜索是全站唯一的线路号查询入口 → 就地筛选全市视图（面板不再另设查询框）；
      // 带 fromCity 的来自全市内部的「打开线路」出口（车辆详情 / 已筛选芯片），仍走换线
      if (this.view === 'city' && !p.fromCity) {
        const c = this.$refs.mapC
        if (c) c.cityFilterByNo(p.lineName || p.lineNo || '')
        return
      }
      const code = p.lineCode || buildLineCode(p.lineName || p.lineNo || '', p.direction || 0)
      // 同线路重复查询：lineCode 不变时 LineMap 的 watch 不会触发，需手动强刷重发请求
      const sameLine = this.mapMount && code === this.lineCode
      this.applyPick(p)
      // 换线路一律落回地图：窗里的内容会随 lineNo 变化重拉，但用户要看的是新线走向
      this.view = 'map'
      this.writeHomeLine()
      if (sameLine) {
        const c = this.$refs.mapC
        if (c) {
          // 汉奇模式：lineNo 是线路名而非数字，loadByLine 会生成错误的 buildLineCode；
          // 改用 loadHanqiLine 直接按 hqLineId 拉数据
          if (this.lineSource === 'hanqi') {
            c.loadHanqiLine()
          } else {
            c.loadByLine(this.lineNo, this.direction)
          }
        }
      }
    },
    // 切数据源（汉奇 → 武汉公交，或反之）：LineMap 会重拉对应线路；这里清掉失效的线路记忆
    setLineSource(src) {
      this.lineSource = src
      if (src === 'whbus') this.hqLineId = ''
    },
    // 分段切换：有线路时是「开窗 / 收窗」，没线路时单条线路类档位不可达（全市公交始终可达）
    switchView(key) {
      if (!VIEW_KEYS.includes(key)) return
      // 再点当前档 = 收回上一档：有线路回到地图，没线路回到线路库落地页
      const home = this.hasLine ? 'map' : 'db'
      if (key === this.view) { this.view = home; return }
      // 全市公交需激活：未激活弹窗校验，已激活直接进
      if (key === 'city') { this.enterCity(); return }
      // 实时线路窗只服务武汉公交（LineStops 按 420100-lineCode 协议拉站点/车辆），
      // 汉奇线开了只会空窗，还会把车型码首位当公司号误挂徽标 → 直接拦在此处
      if (key === 'stops' && this.lineSource === 'hanqi') {
        uni.showToast({ title: '汉奇线路暂不支持实时线路视图', icon: 'none' })
        return
      }
      if (!this.hasLine && LINE_VIEWS.includes(key)) {
        uni.showToast({ title: '请先选择一条线路', icon: 'none' })
        return
      }
      this.view = key
    },
    // 全市公交自己交回视图档位（首次进入时用户拒了那笔扫描开销）：档位判据只留在宿主一处
    onExitCity() {
      if (this.view !== 'city') return
      this.view = this.hasLine ? 'map' : 'db'
    },
    // 线路徽标只由线路决定，方向变了不需要重写
    writeHomeLine() {
      try {
        if (!this.lineCode) {
          uni.removeStorageSync(HOME_LINE_KEY)
          return
        }
        uni.setStorageSync(HOME_LINE_KEY, {
          lineCode: this.lineCode,
          lineName: this.lineName,
          direction: this.direction,
          startStop: this.startStop,
          endStop: this.endStop,
          // 数据源（汉奇/武汉公交）与汉奇线路 ID，恢复时一并还原
          source: this.lineSource,
          lineId: this.hqLineId,
        })
      } catch (e) {
        /* 存储不可用就只影响下次记忆的恢复，不打扰用户 */
      }
    },
    restore() {
      let saved = null
      try {
        saved = uni.getStorageSync(HOME_LINE_KEY)
      } catch (e) {
        saved = null
      }
      if (!saved || !saved.lineCode) return
      this.applyPick(typeof saved === 'string' ? JSON.parse(saved) : saved)
      this.view = 'map'
    },
    // 全市公交是否已激活（激活后持久化，免重复激活）
    isCityActivated() {
      try { return !!uni.getStorageSync(CITY_ACT_KEY) } catch (e) { return false }
    },
    // 进入全市公交：未激活弹出自定义激活弹窗，已激活直接进
    enterCity() {
      if (this.isCityActivated()) { this.view = 'city'; return }
      this.actCode = ''
      this.actShow = true
    },
    // 激活弹窗：关闭（取消 / 点遮罩）
    actClose() {
      this.actShow = false
    },
    // 激活弹窗：校验激活码，正确则持久化并进入全市公交
    actConfirm() {
      const code = (this.actCode || '').trim()
      if (code === CITY_ACT_CODE) {
        try { uni.setStorageSync(CITY_ACT_KEY, 1) } catch (e) { /* 存储不可用时下次再激活 */ }
        this.actShow = false
        uni.showToast({ title: '激活成功', icon: 'success' })
        this.view = 'city'
      } else {
        uni.showToast({ title: '激活码错误', icon: 'none' })
      }
    },
    // 顶栏账号胶囊：开「账号与设置」窗；会话已失效时胶囊会引导重新登录
    onAccount() {
      this.acctConfirm = false
      this.account = currentAccount()
      if (!this.account) {
        uni.redirectTo({ url: '/pages/login/login' })
        return
      }
      this.syncIdentity()
      this.skin = getSkin()
      this.refreshDefault = getRefreshDefault()
      this.mapSource = getMapSource()
      this.sessionDays = getSessionDays()
      this.refreshSessionText()
      // 密码表单每次开窗都清空，并回填「是否已自定义」
      this.pwdOld = ''
      this.pwdNew = ''
      this.pwdConfirm = ''
      this.pwdShow = false
      this.pwdCustom = hasCustomPass(this.account)
      this.accountShow = true
    },
    // 用户名 + 头像（胶囊常驻显示，面板打开时也用它回填输入缓冲）
    syncIdentity() {
      this.dispName = getDisplayName(this.account)
      this.avatar = getAvatar(this.account)
      this.setName = this.dispName
    },
    // 更换头像：选图 → 校验/压缩 → 落本地存储 → 胶囊即时换脸（可反复更换，每次覆盖）
    onChangeAvatar() {
      pickAvatar(this.account).then((url) => {
        if (!url) return
        this.avatar = url
        uni.showToast({ title: '头像已更新', icon: 'none' })
      })
    },
    // 恢复默认头像：清掉自定义图
    onResetAvatar() {
      removeAvatar(this.account)
      this.avatar = ''
      uni.showToast({ title: '已恢复默认头像', icon: 'none' })
    },
    // 保存用户名（账号名只读不改）；清空即回退显示账号名
    saveName() {
      const n = setDisplayName(this.account, this.setName)
      this.dispName = n
      this.setName = n
      uni.showToast({ title: n ? '用户名已保存' : '用户名已清空，显示账号名', icon: 'none' })
    },
    // 皮肤：黑 / 白 / 跟随系统（写 <html data-skin>，全局 CSS 换肤）
    onSkin(key) {
      this.skin = setSkin(key)
    },
    // 地图来源：高德 / 腾讯（自绘走向图底图瓦片源，改完对打开的地图即时生效）
    onMapSource(key) {
      this.mapSource = setMapSource(key)
      const c = this.$refs.mapC
      if (c && typeof c.onMapSourceChange === 'function') c.onMapSourceChange()
      uni.showToast({ title: `地图来源：${key === 'tencent' ? '腾讯地图' : '高德地图'}`, icon: 'none' })
    },
    // 全局默认刷新：实时线路 / 实时车辆未手动选过间隔时采用；已打开的视图即时跟随
    onRefreshDefault(sec) {
      this.refreshDefault = setRefreshDefault(sec)
      ;['mapC', 'stopsC'].forEach((key) => {
        const c = this.$refs[key]
        if (c && typeof c.onGlobalRefresh === 'function') c.onGlobalRefresh(this.refreshDefault)
      })
      uni.showToast({ title: sec > 0 ? `全局默认刷新：每 ${sec} 秒` : '全局默认刷新：手动', icon: 'none' })
    },
    // 登录有效期：立即生效（从当下重算当前会话到期时间）
    onSessionDays(days) {
      this.sessionDays = setSessionDays(days)
      this.refreshSessionText()
      uni.showToast({ title: days > 0 ? `登录有效期：${days} 天` : '登录有效期：永不过期', icon: 'none' })
    },
    refreshSessionText() {
      const info = getSessionInfo()
      if (!info) {
        this.sessionExpText = '会话已失效'
        return
      }
      if (!info.expiresAt) {
        this.sessionExpText = '已登录 · 永不过期'
        return
      }
      const d = new Date(info.expiresAt)
      const pad = (x) => String(x).padStart(2, '0')
      this.sessionExpText = `已登录 · ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 到期`
    },
    // 修改登录密码：验当前密码 + 两次新密码一致，成功后清空输入并标记已自定义
    onChangePwd() {
      if (!this.pwdOld || !this.pwdNew || !this.pwdConfirm) {
        uni.showToast({ title: '请填写当前密码与新密码', icon: 'none' })
        return
      }
      if (this.pwdNew !== this.pwdConfirm) {
        uni.showToast({ title: '两次输入的新密码不一致', icon: 'none' })
        return
      }
      const r = changePassword(this.account, this.pwdOld, this.pwdNew)
      if (!r.ok) {
        uni.showToast({ title: r.error || '修改失败', icon: 'none' })
        return
      }
      this.pwdOld = ''
      this.pwdNew = ''
      this.pwdConfirm = ''
      this.pwdCustom = true
      uni.showToast({ title: '密码已修改', icon: 'success' })
    },
    // 恢复默认口令：需先在「当前密码」输入验证身份，否则不受理（防误锁）
    onResetPwd() {
      if (!this.pwdOld) {
        uni.showToast({ title: '请先填写当前密码以验证身份', icon: 'none' })
        return
      }
      const r = resetPassword(this.account, this.pwdOld)
      if (!r.ok) {
        uni.showToast({ title: r.error || '恢复失败', icon: 'none' })
        return
      }
      this.pwdOld = ''
      this.pwdNew = ''
      this.pwdConfirm = ''
      this.pwdCustom = false
      uni.showToast({ title: '已恢复默认口令', icon: 'success' })
    },
    // 账号窗内确认注销：清会话回登录页
    onLogout() {
      logout()
      this.account = ''
      this.accountShow = false
      this.acctConfirm = false
      uni.reLaunch({ url: '/pages/login/login' })
    },
    // 窗内切方向 → 反向同步给地图视角（地图那侧的 watch 会跟着换标记集）
    onSetDir(dir) {
      this.direction = Number(dir || 0)
      this.writeHomeLine()
    },
  },
}
</script>

<style>
.home {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  background: #0b1020;
  color: #e2e8f0;
}
/* 独立顶栏卡：与旧首页 .stack 同宽口径（宽屏按 375 基准，1rpx = 0.5px） */
.home-top {
  flex: 0 0 auto;
  width: 100%;
  max-width: 1320rpx;
  margin: 0 auto;
  padding: 24rpx 24rpx 0;
  padding-top: calc(24rpx + var(--status-bar-height, 0px));
  box-sizing: border-box;
}
/* 主视图：地图视图整屏铺满（顶栏长在卡里），其余视图贴住视口底并可自己滚 */
.home-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}
.home-scroll {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.home-inner {
  width: 100%;
  max-width: 1320rpx;
  margin: 0 auto;
  padding: 24rpx 24rpx 48rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
/* 地图态：主视图吃掉整屏，不给内边距（LineMap 自己高度 100%） */
.home--map .home-stage {
  padding: 0;
}

/* ── 全市公交激活弹窗：与全局深色玻璃卡同一套视觉（配色/描边/高光对齐 LineSearch 主按钮）── */
.act-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 7, 16, 0.62);
  animation: act-fade 0.18s ease;
}
.act-card {
  width: 560rpx;
  max-width: calc(100vw - 80rpx);
  box-sizing: border-box;
  padding: 44rpx 40rpx 34rpx;
  background: rgba(11, 16, 32, 0.96);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 28rpx;
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.18);
  animation: act-pop 0.2s ease;
}
.act-title {
  font-size: 32rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  text-align: center;
  color: #eef1ff;
}
.act-desc {
  margin-top: 12rpx;
  font-size: 24rpx;
  text-align: center;
  color: rgba(255, 255, 255, 0.55);
}
.act-groove {
  margin-top: 32rpx;
  display: flex;
  align-items: center;
  height: 84rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  transition: border-color 0.2s, background 0.2s;
}
.act-groove:focus-within {
  border-color: rgba(129, 140, 248, 0.6);
  background: rgba(99, 102, 241, 0.1);
}
.act-input {
  flex: 1;
  height: 100%;
  font-size: 28rpx;
  color: #eef1ff;
}
.act-ph {
  color: rgba(255, 255, 255, 0.35);
}
.act-btns {
  margin-top: 34rpx;
  display: flex;
  gap: 20rpx;
}
.act-btn {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  text-align: center;
  border-radius: 16rpx;
  font-size: 28rpx;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, filter 0.2s;
}
.act-btn.ghost {
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
}
.act-btn.main {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  box-shadow: 0 10rpx 26rpx rgba(79, 110, 247, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.act-btn.main:hover {
  filter: brightness(1.08);
}
.act-btn:active {
  transform: scale(0.96);
}
@keyframes act-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes act-pop {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}

/* ── 账号窗（FloatWin 内）：信息行 + 注销键，同款玻璃口径 ── */
.acct {
  padding: 26rpx 28rpx 30rpx;
  box-sizing: border-box;
}
.acct-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 14rpx 0;
}
.acct-label {
  flex: 0 0 auto;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.5);
}
.acct-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 26rpx;
  font-weight: 700;
  color: #eef1ff;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.acct-value.ok {
  color: #34d399;
}
.acct-tip {
  margin-top: 10rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.38);
}
.acct-logout {
  margin-top: 24rpx;
  height: 76rpx;
  line-height: 76rpx;
  text-align: center;
  border-radius: 18rpx;
  font-size: 27rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #fb7185;
  background: rgba(244, 63, 94, 0.12);
  border: 2rpx solid rgba(244, 63, 94, 0.4);
  cursor: pointer;
  transition: background 0.18s, transform 0.15s;
}
.acct-logout:hover {
  background: rgba(244, 63, 94, 0.2);
}
.acct-logout:active {
  transform: scale(0.97);
}
/* ── 身份区：头像（点击更换）+ 用户名输入 + 只读账号名 ── */
.acct-id {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 6rpx 0 18rpx;
}
.acct-avatar {
  position: relative;
  flex: 0 0 auto;
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.35), rgba(6, 182, 212, 0.3));
  border: 3rpx solid rgba(129, 140, 248, 0.5);
  cursor: pointer;
  transition: filter 0.18s;
}
.acct-avatar:hover {
  filter: brightness(1.15);
}
.acct-avatar-img {
  width: 100%;
  height: 100%;
}
.acct-avatar-txt {
  font-size: 52rpx;
  font-weight: 800;
  color: #eef1ff;
}
/* 悬浮相机角标：暗示「可点更换」 */
.acct-avatar-cam {
  position: absolute;
  right: -2rpx;
  bottom: -2rpx;
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  font-size: 22rpx;
  border-radius: 50%;
  color: #fff;
  background: rgba(99, 102, 241, 0.92);
  border: 3rpx solid rgba(11, 16, 32, 0.9);
}
.acct-id-main {
  flex: 1;
  min-width: 0;
}
.acct-name-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
}
.acct-name-input {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  font-size: 27rpx;
  font-weight: 700;
  color: #eef1ff;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 14rpx;
}
.acct-name-ph {
  color: rgba(255, 255, 255, 0.32);
  font-weight: 400;
}
.acct-name-save {
  flex: 0 0 auto;
  height: 64rpx;
  line-height: 64rpx;
  padding: 0 26rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  cursor: pointer;
  transition: filter 0.18s, transform 0.15s;
}
.acct-name-save:hover {
  filter: brightness(1.1);
}
.acct-name-save:active {
  transform: scale(0.95);
}
.acct-id-sub {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.42);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 头像操作行：更换 / 恢复默认 + 格式提示 */
.acct-avatar-ops {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 0 0 6rpx;
}
.acct-mini {
  height: 52rpx;
  line-height: 52rpx;
  padding: 0 22rpx;
  border-radius: 12rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  cursor: pointer;
  transition: background 0.18s;
}
.acct-mini:hover {
  background: rgba(99, 102, 241, 0.18);
}
.acct-mini-hint {
  flex: 1;
  min-width: 0;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.36);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 分节分隔线与小节标题 */
.acct-div {
  height: 2rpx;
  margin: 22rpx 0;
  background: rgba(255, 255, 255, 0.08);
}
.acct-sec-title {
  font-size: 24rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.62);
  margin-bottom: 14rpx;
}
/* 分段选择器（有效期 / 刷新 / 皮肤共用）：凹槽底 + 选中靛蓝胶囊 */
.acct-seg {
  display: flex;
  gap: 8rpx;
  padding: 6rpx;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.acct-seg-item {
  flex: 1;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 10rpx;
  font-size: 23rpx;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
  white-space: nowrap;
}
.acct-seg-item:hover {
  color: rgba(255, 255, 255, 0.85);
}
.acct-seg-item.on {
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  box-shadow: 0 6rpx 16rpx rgba(99, 102, 241, 0.35);
}
/* 窗内二次确认态 */
.acct-q {
  padding: 18rpx 0 26rpx;
  font-size: 27rpx;
  line-height: 1.6;
  text-align: center;
  color: #eef1ff;
}
.acct-btns {
  display: flex;
  gap: 20rpx;
}
.acct-btn {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  text-align: center;
  border-radius: 16rpx;
  font-size: 28rpx;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, filter 0.2s;
}
.acct-btn.ghost {
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
}
.acct-btn.main {
  color: #fff;
  background: linear-gradient(135deg, #f43f5e, #fb7185);
  box-shadow: 0 10rpx 26rpx rgba(244, 63, 94, 0.35), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.acct-btn.main:hover {
  filter: brightness(1.08);
}
.acct-btn:active {
  transform: scale(0.96);
}
/* 密码修改：输入行整宽、常规字重；保存用靛蓝（非注销的玫红） */
.acct-pwd-input {
  width: 100%;
  margin-top: 14rpx;
  font-weight: 400;
}
.acct-pwd-ops {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
}
.acct-btn.save {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  box-shadow: 0 10rpx 26rpx rgba(99, 102, 241, 0.35), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.acct-btn.save:hover {
  filter: brightness(1.08);
}
</style>
