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
        :sim-signboard="simSignboard"
        :embedded="true"
        :fs-enabled="false"
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
        :title="'实时线路 · ' + displayLineName"
        sub="站点 · 在线车辆 · 营运信息"
        :width-rpx="1120"
        max-height="76vh"
        resize-key="stops"
        @close="view = 'map'"
      >
        <!-- 实时线路窗头工具：极简站牌开关合并成「开启 / 退出」两态（退出入口从面板内
             移到窗头，与其它窗口工具并列，极简面板内只留上下行切换和刷新胶囊） -->
        <template #actions>
          <view
            class="fw-act"
            :class="{ on: minStopsMode }"
            @click.stop="onMinStopsMode(!minStopsMode)"
            :title="minStopsMode ? '退出极简站牌，返回完整视图' : '开启极简站牌：只显示线路头、候车信息与站点序列'"
          >{{ minStopsMode ? '✖️' : '🚏' }}</view>
          <view class="fw-act" @click.stop="onCopyRouteImg" title="复制线路仿真走向图（按当前方向区分上下行）">📷</view>
        </template>
        <LineStops
          ref="stopsC"
          plain
          :line-no="lineNo"
          :line-name="lineName"
          :direction="direction"
          :start-stop="startStop"
          :end-stop="endStop"
          :min-mode="minStopsMode"
          @set-dir="onSetDir"
        />
      </FloatWin>

      <!-- 线路库：同样只在地图里开一扇窗，点一条直达该线路（窗宽留足长线路名 + 起讫站） -->
      <FloatWin
        v-else-if="hasLine && view === 'db'"
        title="线路库"
        sub="本地全量摘要 · 点一条直达"
        :width-rpx="1200"
        max-height="76vh"
        resize-key="db"
        resize-axis="y"
        @close="view = 'map'"
      >
        <LineDb plain @pick="onPickLine" />
      </FloatWin>

      <!-- 线路收藏夹：分段导航里排在「线路库」之后的第五档。
           toPick 带 fromFav=true，选线走统一 onPickLine（会自动收回本窗落回地图） -->
      <FloatWin
        v-else-if="hasLine && view === 'fav'"
        title="线路收藏夹"
        sub="常用线路 · 最多 10 条 · 点一条直达"
        :width-rpx="720"
        max-height="72vh"
        resize-key="fav"
        @close="view = 'map'"
      >
        <FavPanel plain @pick="onPickLine" />
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

          <!-- 分区折叠的总控：点标题逐项折叠，这里一键全收 / 全展；展开态本机记忆 -->
          <view class="acct-fold-bar">
            <text class="acct-fold-hint">点击分区标题可折叠 / 展开</text>
            <view class="acct-fold-btn" @click="toggleAllAcctSections">{{ acctAllOpen ? '全部折叠' : '全部展开' }}</view>
          </view>

          <view class="acct-div"></view>

          <!-- 登录有效期 -->
          <view class="acct-sec-head" @click="toggleAcctSection('session')">
            <text class="acct-sec-title">登录有效期</text>
            <text class="acct-sec-sum" v-if="!acctSec.session">{{ acctSecSummary.session }}</text>
            <text class="acct-sec-chev" :class="{ folded: !acctSec.session }">▾</text>
          </view>
          <view v-show="acctSec.session" class="acct-sec-body">
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
          </view>

          <view class="acct-div"></view>

          <!-- 登录密码：预置口令可改为本机自定义密码（只存哈希；改密 / 恢复均需验当前密码） -->
          <view class="acct-sec-head" @click="toggleAcctSection('pwd')">
            <text class="acct-sec-title">登录密码</text>
            <text class="acct-sec-sum" v-if="!acctSec.pwd">{{ acctSecSummary.pwd }}</text>
            <text class="acct-sec-chev" :class="{ folded: !acctSec.pwd }">▾</text>
          </view>
          <view v-show="acctSec.pwd" class="acct-sec-body">
            <view class="acct-tip">{{ pwdCustom ? '已设置自定义密码，下次登录用新密码；也可恢复为预置口令' : '当前用预置口令登录，可修改为自己的密码（仅存本机哈希）' }}；无需填写旧密码即可修改</view>
            <!-- 眼睛按钮内嵌输入框右侧：新密码与确认密码共用一个关联开关 -->
            <view class="acct-pwd-field">
              <input class="acct-name-input acct-pwd-input" v-model="pwdNew" :password="!pwdShowNew" type="text" placeholder="新密码（6~32 位）" placeholder-class="acct-name-ph" />
              <view class="acct-eye" :class="{ on: pwdShowNew }" @click="pwdShowNew = !pwdShowNew" v-html="pwdShowNew ? svgEyeOn : svgEyeOff" />
            </view>
            <view class="acct-pwd-field">
              <input class="acct-name-input acct-pwd-input" v-model="pwdConfirm" :password="!pwdShowNew" type="text" placeholder="确认新密码" placeholder-class="acct-name-ph" @confirm="onChangePwd" />
              <view class="acct-eye" :class="{ on: pwdShowNew }" @click="pwdShowNew = !pwdShowNew" v-html="pwdShowNew ? svgEyeOn : svgEyeOff" />
            </view>
            <view class="acct-btns">
              <view class="acct-btn ghost" v-if="pwdCustom" @click="onResetPwd">恢复默认口令</view>
              <view class="acct-btn save" @click="onChangePwd">修改密码</view>
            </view>
          </view>

          <view class="acct-div"></view>

          <!-- 刷新间隔（全站统一） -->
          <view class="acct-sec-head" @click="toggleAcctSection('refresh')">
            <text class="acct-sec-title">刷新间隔</text>
            <text class="acct-sec-sum" v-if="!acctSec.refresh">{{ acctSecSummary.refresh }}</text>
            <text class="acct-sec-chev" :class="{ folded: !acctSec.refresh }">▾</text>
          </view>
          <view v-show="acctSec.refresh" class="acct-sec-body">
            <view class="acct-seg">
              <view
                class="acct-seg-item"
                v-for="s in refreshOpts"
                :key="s"
                :class="{ on: refreshDefault === s }"
                @click="onRefreshDefault(s)"
              >{{ s === 0 ? '手动' : s + ' 秒' }}</view>
            </view>
            <view class="acct-tip">实时线路、地图页、极简站牌里的刷新按钮共用此设置；任意一处改动，其余按钮即时同步</view>
          </view>

          <view class="acct-div"></view>

          <!-- 皮肤 -->
          <view class="acct-sec-head" @click="toggleAcctSection('skin')">
            <text class="acct-sec-title">皮肤</text>
            <text class="acct-sec-sum" v-if="!acctSec.skin">{{ acctSecSummary.skin }}</text>
            <text class="acct-sec-chev" :class="{ folded: !acctSec.skin }">▾</text>
          </view>
          <view v-show="acctSec.skin" class="acct-sec-body">
            <view class="acct-seg">
              <view
                class="acct-seg-item"
                v-for="o in skinOpts"
                :key="o.key"
                :class="{ on: skin === o.key }"
                @click="onSkin(o.key)"
              >{{ o.label }}</view>
            </view>
          </view>

          <!-- 主题色：预设色板 + 调色盘。写 --ac CSS 变量族挂 <html>，
               全站按钮 / 页签 / 选中态 / 胶囊即时跟随（预设避开上行青蓝与下行玫红方向色） -->
          <view class="acct-sec-head" @click="toggleAcctSection('accent')">
            <text class="acct-sec-title">主题色</text>
            <text class="acct-sec-sum" v-if="!acctSec.accent">{{ acctSecSummary.accent }}</text>
            <text class="acct-sec-chev" :class="{ folded: !acctSec.accent }">▾</text>
          </view>
          <view v-show="acctSec.accent" class="acct-sec-body">
            <view class="ac-row">
              <view
                v-for="p in accentPresets"
                :key="p.hex"
                class="ac-dot"
                :class="{ on: accent === p.hex }"
                :style="{ background: p.hex }"
                :title="p.label"
                @click="onAccent(p.hex)"
              ></view>
              <!-- 自定义调色盘：内联 HSV，鼠标移入展开 / 移出自动落库 -->
              <view
                class="ac-dot ac-picker"
                :class="{ on: !accentPresets.some((p) => p.hex === accent), open: showPicker }"
                title="调色盘：任选自定义颜色"
                @mouseenter="onPickerEnter"
                @mouseleave="onPickerLeave"
              ></view>
            </view>
            <!-- 内联调色盘面板（仅 H5；跟随 acct-sec-body 流式布局，不 fixed） -->
            <view v-if="showPicker && acctSec.accent" class="cp-wrap" @mouseenter.stop
                  @mouseleave="onPickerLeave"
                  @mousemove="onPickerDrag($event)"
                  @touchmove.prevent="onPickerDrag($event)">
              <view class="cp-area" ref="cpAreaRef"
                    :style="{ '--cp-hue-color': cpHueColor }"
                    @mousedown.stop="onAreaDown($event)"
                    @touchstart.prevent="onAreaDown($event)">
                  <view class="cp-cursor" :style="cpCursorStyle"></view>
                </view>
              </view>
              <view class="cp-hue-bar" ref="cpHueRef"
                    @mousedown.stop="onHueDown($event)"
                    @touchstart.prevent="onHueDown($event)">
                <view class="cp-hue-track" :style="cpHueTrackStyle"></view>
                <view class="cp-hue-cursor" :style="cpHueCursorStyle"></view>
              </view>
              <view class="cp-preview">
                <view class="cp-sw" :style="{ background: activeColor }"></view>
                <text class="cp-hex">{{ activeColor }}</text>
              </view>
            </view>
            <view class="acct-tip">主题色作用于查询按钮 / 页签 / 选中态等强调元素，自定义后本机记忆，改完即时生效</view>
          </view>

          <view class="acct-div"></view>

          <!-- 界面字体：内置 OFL / 厂商免费商用 webfont，unicode-range 分片按需加载。
               选项卡上的字体名直接用真字体渲染当预览（开窗时预载各档 CSS） -->
          <view class="acct-sec-head" @click="toggleAcctSection('font')">
            <text class="acct-sec-title">界面字体</text>
            <text class="acct-sec-sum" v-if="!acctSec.font">{{ acctSecSummary.font }}</text>
            <text class="acct-sec-chev" :class="{ folded: !acctSec.font }">▾</text>
          </view>
          <view v-show="acctSec.font" class="acct-sec-body">
            <view class="font-grid">
              <view
                v-for="o in fontOpts"
                :key="o.key"
                class="font-chip"
                :class="{ on: uiFont === o.key }"
                @click="onFont(o.key)"
              >
                <text class="font-chip-name" :style="{ fontFamily: o.preview }">{{ o.label }}</text>
                <text class="font-chip-note">{{ o.note }}</text>
              </view>
            </view>
            <view class="acct-tip">开源可商用字体，按需分片加载；改完全站即时生效、本机记忆，加载失败自动回退系统字体</view>
          </view>

          <view class="acct-div"></view>

          <!-- 高德地图 KEY：自填后拉官方公交真实轨迹 -->
          <view class="acct-sec-head" @click="toggleAcctSection('map')">
            <text class="acct-sec-title">线路走向</text>
            <text class="acct-sec-sum" v-if="!acctSec.map">{{ acctSecSummary.map }}</text>
            <text class="acct-sec-chev" :class="{ folded: !acctSec.map }">▾</text>
          </view>
          <view v-show="acctSec.map" class="acct-sec-body">
            <view class="amap-sub-label">高德地图 KEY</view>
            <view class="amap-sub-hint">官方公交轨迹 · 走向更精确</view>
            <view class="amap-apply">
              <text class="amap-apply-txt">还没有 KEY？前往高德开放平台免费申请（Web端 JS API 类型）</text>
              <text class="amap-apply-link" @click="openAmapApply">立即申请 ›</text>
            </view>
            <view class="amap-field-label">Key（Web端 JS API）</view>
            <view class="amap-input-row">
              <input
                class="amap-input"
                v-model="amapKeyInput"
                type="text"
                :password="!amapKeyShow"
                placeholder="粘贴 Web端(JS API) Key"
                confirm-type="done"
                @confirm="onAmapKeySave"
              />
              <view class="acct-eye" :class="{ on: amapKeyShow }" @click="amapKeyShow = !amapKeyShow" v-html="amapKeyShow ? svgEyeOn : svgEyeOff" />
            </view>
            <view class="amap-field-label">安全密钥（JS API 2.0，选填）</view>
            <view class="amap-input-row">
              <input
                class="amap-input"
                v-model="amapSecretInput"
                type="text"
                :password="!amapSecretShow"
                placeholder="粘贴安全密钥（securityJsCode）"
                confirm-type="done"
                @confirm="onAmapKeySave"
              />
              <view class="acct-eye" :class="{ on: amapSecretShow }" @click="amapSecretShow = !amapSecretShow" v-html="amapSecretShow ? svgEyeOn : svgEyeOff" />
            </view>
            <view class="amap-btn-row">
              <view class="amap-btn primary" @click="onAmapKeySave">保存 KEY</view>
              <view class="amap-btn" v-if="amapKey || amapSecretInput" @click="onAmapKeyClear">清空</view>
            </view>

            <view class="amap-quota">
              <view class="amap-quota-head">
                <text class="amap-quota-title">今日用量</text>
                <text class="amap-quota-big">{{ amapUsageToday }}<text class="amap-quota-unit"> 次</text></text>
              </view>
              <view class="amap-quota-row">
                <text class="amap-quota-k">高德每日免费额度</text>
                <text class="amap-quota-v dim">以账号类型为准</text>
              </view>
              <text class="amap-quota-link" @click="openAmapQuota">查看实时用量 / 额度明细 ›</text>
            </view>

            <view class="amap-note">
              填 KEY 后线路走向改用高德官方公交轨迹，通常比免 Key 的 OSRM 贴路更精确。⚠ 必须是高德开放平台创建的「Web端(JS API)」类型 Key（Web服务 / REST Key 会报平台不匹配而不生效）；JS API 2.0 若配了安全密钥，填在下方「安全密钥」框即可。KEY 与高德账号绑定，调用可能按高德规则计费或占用免费配额，费用与额度以高德平台为准。本机计数仅供参考，不代表实际账单。留空则始终走免 Key 方案。
            </view>
          </view>

          <view class="acct-div"></view>

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

      <!-- 未选线路时的整屏内容：线路库 / 线路收藏夹（全市公交视图自己铺满，不走这里） -->
      <view v-if="!mapMount" class="home-scroll">
        <view class="home-inner">
          <FavPanel v-if="view === 'fav'" @pick="onPickLine" />
          <LineDb v-else @pick="onPickLine" />
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
  ACCENT_PRESETS,
  getSkin,
  setSkin,
  getAccent,
  setAccent,
  previewAccent,
  getRefreshSec,
  setRefreshSec as saveRefreshSec,
  onRefreshSecChange,
  getSimSignboard,
  setSimSignboard,
  FONT_OPTS,
  getFont,
  setFont,
  ensureFontPreviews,
  getDisplayName,
  setDisplayName,
  getSessionDays,
  setSessionDays,
  getAmapKey,
  getAmapKeyPair,
  setAmapKeyPair,
  getAmapUsageToday,
} from '../../utils/settings.js'
import { getAvatar, removeAvatar, pickAvatar } from '../../utils/avatar.js'
import { getMinStopsMode, setMinStopsMode } from '../../utils/settings.js'
import FavPanel from '../../components/FavPanel.vue'
import { closeAllDropdowns } from '../../utils/dropdown.js'

// 上次查过的线路：下次进来直接落在地图上，省掉「每次都要搜一遍」
const HOME_LINE_KEY = 'whbis:home-line'
// 视图档位：地图是底座，city 是同一张地图的另一种内容，stops / db 是浮在它上面的两扇窗
const VIEW_KEYS = ['map', 'city', 'stops', 'db', 'fav']
// 没选线路时不可达的档位（无线路 = 无单条线路可画）；city 不在内：全市线网不依赖选线
const LINE_VIEWS = ['map', 'stops']
// 全市公交激活：输入正确激活码后持久化，之后免再激活
const CITY_ACT_KEY = 'whbis:city-activated'
const CITY_ACT_CODE = 'BOUNDLESS_558'
// 「账号与设置」各分区的展开态：本机记忆，避免每次开窗都要重新点开
const ACCT_SECTIONS_KEY = 'whbis:acct-sections'
const ACCT_SECTION_KEYS = ['session', 'pwd', 'refresh', 'skin', 'accent', 'font']
// 默认：常用的小分区展开，字体（13 档）与密码表单这类长分区默认收起，
// 让面板首屏就能看到全部设置项，不用一路滚到底
const ACCT_SECTIONS_DEFAULT = {
  session: true, pwd: false, refresh: true, skin: true, accent: true, font: false,
}

export default {
  name: 'HomePage',
  components: { LineMap, LineSearch, LineStops, LineDb, FloatWin, FavPanel },
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
      // 登录密码修改：窗内输入缓冲 + 是否已自定义 + 明文可见开关（新密码/确认密码关联；无需旧密码）
      pwdNew: '',
      pwdConfirm: '',
      pwdShowNew: false,
      // 眼睛图标：单色描边 SVG，跟随文字色（currentColor）、1em 尺寸，避免彩色 emoji 在暗色面板上突兀
      svgEyeOn: '<svg viewBox="0 0 24 24" width="1em" height="1em" style="display:block" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.2 10-6.2S22 12 22 12s-3.5 6.2-10 6.2S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>',
      svgEyeOff: '<svg viewBox="0 0 24 24" width="1em" height="1em" style="display:block" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 16 16"/><path d="M9.9 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-2.7 3.5M6.3 6.5A16.4 16.4 0 0 0 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4.4-.9"/><path d="M9.9 9.9a2.9 2.9 0 0 0 4.2 4.2"/></svg>',
      pwdCustom: false,
      skinOpts: SKIN_OPTS,
      // 主题色：当前生效 hex（含自定义）与预设色板
      accent: '#6366f1',
      accentPresets: ACCENT_PRESETS,
      // 内联 HSV 调色盘状态
      showPicker: false,
      _pDrag: false,     // 'sv'|'h' 当前拖拽区域，无则为 false
      _pHueBase: 0,      // 拖动前的基准色相（用于区分"改 hue"vs"改 sat/bri"）
      pickerH: 0,        // 当前 hue (0-360)
      pickerS: 1,        // 当前 saturation (0-1)
      pickerV: 1,        // 当前 value (0-1)
      refreshOpts: REFRESH_DEFAULT_OPTS,
      // 高德地图 KEY + 安全密钥：自填后拉官方公交真实轨迹（本机记忆）
      amapKey: '',
      amapKeyInput: '',
      amapSecretInput: '',
      amapKeyShow: false,
      amapSecretShow: false,
      amapUsageToday: 0,
      amapApplyUrl: 'https://console.amap.com/dev/key/app',
      amapQuotaUrl: 'https://console.amap.com/dev/statistic',
      // 仿真站牌设计：实时线路走向改用站牌风格（本机记忆）
      simSignboard: false,
      // 界面字体：当前生效档 + 档位列表（preview = 选项卡预览用的 family 串）
      uiFont: 'system',
      fontOpts: FONT_OPTS.map((o) => ({ ...o, preview: o.family ? o.family + ', sans-serif' : 'inherit' })),
      // 极简站牌模式：只保留线路头 + 候车信息 + 站点序列，隐藏多余控件
      minStopsMode: false,
      // 设置分区展开态（本机记忆，见 ACCT_SECTIONS_DEFAULT）
      acctSec: { ...ACCT_SECTIONS_DEFAULT },
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
      // 分段五档：label 是落地页/浮窗顶栏的全名；short 只给 plain 形态（并入地图左上
      // 控制卡）用，5 个全名在 720rpx 控制卡里会挤爆。收藏夹排在「线路库」之后。
      views: [
        { key: 'map', label: '实时地图', short: '地图' },
        { key: 'city', label: '全市公交', short: '全市' },
        { key: 'stops', label: '实时线路', short: '线路' },
        { key: 'db', label: '线路库', short: '线路库' },
        { key: 'fav', label: '线路收藏夹', short: '收藏' },
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
    // 线路展示名（带「路」单位，环线不追加）：顶栏 meta 与浮窗标题共用
    displayLineName() {
      const nm = String(this.lineName || this.lineNo || '').trim()
      if (!nm) return ''
      return /(内环|外环|内线|外线)$/.test(nm) ? nm : nm + ' 路'
    },
    metaText() {
      if (!this.lineNo) return ''
      return `${this.displayLineName} · ${this.direction === 1 ? '下行' : '上行'}`
    },
    // 默认头像：用户名 / 账号名的首字母色块
    avatarLetter() {
      return (this.dispName || this.account || '·').trim().charAt(0).toUpperCase()
    },
    // 折叠态下每个分区显示的「当前值」摘要，收起后仍能一眼看到设置结果
    acctSecSummary() {
      const font = this.fontOpts.find((o) => o.key === this.uiFont)
      const skin = this.skinOpts.find((o) => o.key === this.skin)
      const accent = this.accentPresets.find((p) => p.hex === this.accent)
      const days = this.sessionOpts.find((o) => o.days === this.sessionDays)
      return {
        session: days ? days.label : `${this.sessionDays} 天`,
        pwd: this.pwdCustom ? '自定义密码' : '预置口令',
        refresh: this.refreshDefault === 0 ? '手动刷新' : `${this.refreshDefault} 秒`,
        skin: skin ? skin.label : '黑色',
        accent: accent ? accent.label : '自定义',
        font: font ? font.label : '系统默认',
        // 合并分区摘要：KEY 是否已填
        map: `KEY ${this.amapKey ? '已填' : '未填'}`,
      }
    },
    // 内联调色盘：渲染辅助计算属性
    cpHueColor() {
      return this.pickerToHex(this.pickerH, 1, 1)
    },
    cpCursorStyle() {
      // 十字光标位置：cx = s*width, cy = (1-v)*height；黑圈外置白环
      const x = `${this.pickerS * 100}%`
      const y = `${(1 - this.pickerV) * 100}%`
      return { left: x, top: y }
    },
    activeColor() {
      return this.pickerToHex(this.pickerH, this.pickerS, this.pickerV)
    },
    cpHueTrackStyle() {
      // 渐变提示：360° 彩虹带，cursor 位置不依赖它（cursor 独立绘制）
      return ''
    },
    cpHueCursorStyle() {
      const left = `${(this.pickerH / 360) * 100}%`
      return { left }
    },
    // 是否所有分区都已展开（决定快捷按钮文案与方向）
    acctAllOpen() {
      return ACCT_SECTION_KEYS.every((k) => !!this.acctSec[k])
    },
  },
  onLoad(query) {
    // 登录守卫：未登录一律回登录页（pages.json 首页已指向 login，这里兜底深链/回退）
    if (!requireLogin()) return
    this.account = currentAccount()
    // 皮肤：页面加载时即从存储读回，避免 settings 面板默认显示「黑色」而非实际保存值
    this.skin = getSkin()
    // 刷新间隔全站统一：任一控件改动时，反向同步设置面板里的选中态
    this.refreshDefault = getRefreshSec()
    this._offRefresh = onRefreshSecChange((sec) => { this.refreshDefault = sec })
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
    if (this._offRefresh) {
      this._offRefresh()
      this._offRefresh = null
    }
    this.fire(['cleanup', 'stopAutoRefresh'])
  },
  methods: {
    // 分区展开态：本机记忆（只认已知的 key，脏数据自动回退默认值）
    loadAcctSections() {
      let saved = null
      try {
        saved = uni.getStorageSync(ACCT_SECTIONS_KEY)
        if (typeof saved === 'string') saved = JSON.parse(saved)
      } catch (e) { saved = null }
      const next = { ...ACCT_SECTIONS_DEFAULT }
      if (saved && typeof saved === 'object') {
        ACCT_SECTION_KEYS.forEach((k) => {
          if (typeof saved[k] === 'boolean') next[k] = saved[k]
        })
      }
      this.acctSec = next
    },
    saveAcctSections() {
      try { uni.setStorageSync(ACCT_SECTIONS_KEY, this.acctSec) } catch (e) { /* 存储不可用仅本次生效 */ }
    },
    toggleAcctSection(key) {
      if (!ACCT_SECTION_KEYS.includes(key)) return
      this.acctSec = { ...this.acctSec, [key]: !this.acctSec[key] }
      this.saveAcctSections()
    },
    // 一键折叠 / 展开全部：已全开就全收，否则全展开
    toggleAllAcctSections() {
      const open = !this.acctAllOpen
      const next = {}
      ACCT_SECTION_KEYS.forEach((k) => { next[k] = open })
      this.acctSec = next
      this.saveAcctSections()
    },
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
      const code = p.lineCode || buildLineCode(p.lineName || p.lineNo || '', p.direction || 0)
      const no = String(code).split('-')[1] || p.lineName || ''
      this.lineCode = code
      this.lineNo = no
      this.lineName = p.lineName || no
      this.direction = Number(p.direction || 0)
      this.startStop = p.startStop || ''
      this.endStop = p.endStop || ''
    },
    // 顶栏搜索、线路库与线路库内收藏夹共用的选线出口
    onPickLine(p) {
      // 全市公交态：顶栏搜索是全站唯一的线路号查询入口 → 就地筛选全市视图（面板不再另设查询框）；
      // 带 fromCity 的来自全市内部的「打开线路」出口（车辆详情 / 已筛选芯片），仍走换线
      if (this.view === 'city' && !p.fromCity && !p.fromFav) {
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
        // 传展示号（H81）避免徽章退回内部码（81）；请求仍用 this.lineNo
        if (c) c.loadByLine(this.lineNo, this.direction, this.lineName)
      }
    },
    // 分段切换：有线路时是「开窗 / 收窗」，没线路时单条线路类档位不可达（全市公交始终可达）
    switchView(key) {
      if (!VIEW_KEYS.includes(key)) return
      // 再点当前档 = 收回上一档：有线路回到地图，没线路回到线路库落地页
      const home = this.hasLine ? 'map' : 'db'
      if (key === this.view) { this.view = home; return }
      // 全市公交需激活：未激活弹窗校验，已激活直接进
      if (key === 'city') { this.enterCity(); return }
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
      // 旧版外部线路记忆（lineCode 形如 hanqi-xxx，现有数据源拉不到数据）：清掉这条过期记忆，
      // 否则每次直接进本页都恢复不了线路、卡在线路库落地页；清掉后下次起恢复最近一次有效线路
      if (saved.source === 'hanqi' || String(saved.lineCode).startsWith('hanqi-')) {
        try { uni.removeStorageSync(HOME_LINE_KEY) } catch (e) { /* 存储不可用时保持忽略 */ }
        return
      }
      try {
        this.applyPick(typeof saved === 'string' ? JSON.parse(saved) : saved)
        this.view = 'map'
      } catch (e) {
        // 记忆损坏（JSON 解析失败等）：清掉，落回线路库落地页，别让异常打断 onLoad
        try { uni.removeStorageSync(HOME_LINE_KEY) } catch (e2) { /* 忽略 */ }
      }
    },
    // 全市公交是否已激活（激活后持久化，免重复激活）
    isCityActivated() {
      try { return !!uni.getStorageSync(CITY_ACT_KEY) } catch (e) { return false }
    },
    // 进入全市公交：未激活弹出自定义激活弹窗，已激活直接进
    enterCity() {
      if (this.isCityActivated()) { this.view = 'city'; return }
      closeAllDropdowns()
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
      closeAllDropdowns()
      this.acctConfirm = false
      this.account = currentAccount()
      if (!this.account) {
        uni.redirectTo({ url: '/pages/login/login' })
        return
      }
      this.syncIdentity()
      this.skin = getSkin()
      this.accent = getAccent()
      this.refreshDefault = getRefreshSec()
      const amapPair = getAmapKeyPair()
      this.amapKey = amapPair.key
      this.amapKeyInput = amapPair.key
      this.amapSecretInput = amapPair.secret
      this.amapUsageToday = getAmapUsageToday()
      this.sessionDays = getSessionDays()
      this.uiFont = getFont()
      this.simSignboard = getSimSignboard()
      this.minStopsMode = getMinStopsMode()
      this.loadAcctSections()
      // 预载各档 CSS：让「界面字体」选项卡用真字体渲染当预览
      ensureFontPreviews()
      this.refreshSessionText()
      // 密码表单每次开窗都清空，并回填「是否已自定义」
      this.pwdNew = ''
      this.pwdConfirm = ''
      this.pwdShowNew = false
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
    // 主题色：写 --ac CSS 变量族挂 <html>，全站强调元素即时跟随；本机持久化
    onAccent(hex) {
      this.accent = setAccent(hex)
    },
    // ── 颜色空间转换（本地副本，避免污染 settings.js 的内部 API）──
    _hexToRgbNorm(hex) {
      const n = parseInt(hex.slice(1), 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    },
    _rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      let h = 0, s = 0
      const l = (mx + mn) / 2
      if (mx !== mn) {
        const d = mx - mn
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        if (mx === r) h = (g - b) / d + (g < b ? 6 : 0)
        else if (mx === g) h = (b - r) / d + 2
        else h = (r - g) / d + 4
        h *= 60
      }
      return [h, s * 100, l * 100]
    },
    _hslToHex(h, s, l) {
      h = ((h % 360) + 360) % 360; s /= 100; l /= 100
      const c = (1 - Math.abs(2 * l - 1)) * s
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
      const m = l - c / 2
      let rr = 0, gg = 0, bb = 0
      if (h < 60) { rr = c; gg = x } else if (h < 120) { rr = x; gg = c }
      else if (h < 180) { gg = c; bb = x } else if (h < 240) { gg = x; bb = c }
      else if (h < 300) { rr = x; bb = c } else { rr = c; bb = x }
      const t = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
      return '#' + t(rr) + t(gg) + t(bb)
    },
    // ── 内联 HSV 调色盘（H5 only，鼠标从面板移开时自动落库）──
    onPickerEnter() {
      // #ifdef H5
      this.showPicker = true
      this.syncPickerFromAccent()
      // #endif
    },
    onPickerLeave() {
      // 鼠标离开整块面板（cp-wrap + ac-picker 都触发），落库一次
      // #ifdef H5
      if (!this.showPicker) return
      this.showPicker = false
      this.releasePickers()
      this.commitPicker()
      // #endif
    },
    commitPicker() {
      const hex = this.pickerToHex(this.pickerH, this.pickerS, this.pickerV)
      if (hex && hex !== this.accent) this.accent = setAccent(hex)
    },
    syncPickerFromAccent() {
      const rgb = this._hexToRgbNorm(getAccent())
      if (rgb) {
        const [h, s, l] = this._rgbToHsl(rgb[0], rgb[1], rgb[2])
        this.pickerH = h
        this.pickerS = s / 100
        this.pickerV = l / 100
      } else {
        this.pickerH = 231; this.pickerS = 0.76; this.pickerV = 0.95  // fallback to default indigo
      }
    },
    pickerToHex(h, s, v) {
      return this._hslToHex(h, s * 100, v * 100)
    },
    releasePickers() {
      document.removeEventListener('mousemove', this._pMoveGlobal)
      document.removeEventListener('mouseup', this._pUpGlobal)
      document.removeEventListener('touchmove', this._pMoveGlobal)
      document.removeEventListener('touchend', this._pUpGlobal)
      this._pMoveGlobal = null
      this._pUpGlobal = null
      this._pDrag = false
    },
    onAreaDown(e) {
      // #ifdef H5
      this._pDrag = 'sv'
      this._pHueBase = this.pickerH
      this._attachPickers()
      this._doAreaMove(e)
      // #endif
    },
    onHueDown(e) {
      // #ifdef H5
      this._pDrag = 'h'
      this._attachPickers()
      this._doHueMove(e)
      // #endif
    },
    _attachPickers() {
      this._pMoveGlobal = (e) => {
        if (this._pDrag === 'sv') this._doAreaMove(e)
        else if (this._pDrag === 'h') this._doHueMove(e)
      }
      this._pUpGlobal = () => { this.releasePickers(); this.commitPicker() }
      document.addEventListener('mousemove', this._pMoveGlobal, true)
      document.addEventListener('mouseup', this._pUpGlobal, true)
      document.addEventListener('touchmove', this._pMoveGlobal, { passive: false })
      document.addEventListener('touchend', this._pUpGlobal, true)
    },
    _doAreaMove(e) {
      // #ifdef H5
      const el = this.$refs.cpAreaRef
      if (!el) return
      const r = el.getBoundingClientRect()
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY
      this.pickerS = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      this.pickerV = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height))
      previewAccent(this.pickerToHex(this.pickerH, this.pickerS, this.pickerV))
      // #endif
    },
    _doHueMove(e) {
      // #ifdef H5
      const el = this.$refs.cpHueRef
      if (!el) return
      const r = el.getBoundingClientRect()
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      let h = Math.round(((clientX - r.left) / r.width) * 360) % 360
      // 防跳变：跨过 0°/360° 边界时用短线走
      const diff = h - this._pHueBase
      if (Math.abs(diff) > 180) h = (this._pHueBase + (diff > 0 ? diff - 360 : diff + 360) + 360) % 360
      this.pickerH = h
      previewAccent(this.pickerToHex(h, this.pickerS, this.pickerV))
      // #endif
    },
    onPickerDrag(e) {
      // 兼容：如果事件冒泡到 cp-wrap 层面（例如 touch 穿透），也转发给对应子区域
      // #ifdef H5
      if (this._pDrag === 'sv') this._doAreaMove(e)
      else if (this._pDrag === 'h') this._doHueMove(e)
      // #endif
    },
    // 高德链接：申请 KEY / 查看用量额度（H5 新标签；App 端调系统浏览器）
    openAmapUrl(url) {
      // #ifdef H5
      window.open(url, '_blank', 'noopener,noreferrer')
      // #endif
      // #ifdef APP-PLUS
      plus.runtime.openURL(url)
      // #endif
    },
    openAmapApply() { this.openAmapUrl(this.amapApplyUrl) },
    openAmapQuota() { this.openAmapUrl(this.amapQuotaUrl) },
    // 保存高德 KEY：落库后重置地图的轨迹标记并对当前线路重新规划，立即生效
    onAmapKeySave() {
      const key = setAmapKeyPair(this.amapKeyInput, this.amapSecretInput)
      const pair = getAmapKeyPair()
      this.amapKey = pair.key
      this.amapKeyInput = pair.key
      this.amapSecretInput = pair.secret
      const c = this.$refs.mapC
      if (c && typeof c.onAmapKeyChange === 'function') c.onAmapKeyChange()
      uni.showToast({ title: key ? '高德 KEY 已保存' : '已清空，使用免 Key 方案', icon: 'none' })
    },
    onAmapKeyClear() {
      this.amapKeyInput = ''
      this.amapSecretInput = ''
      this.onAmapKeySave()
    },
    // 仿真站牌设计：纯展示开关，落库后由 prop 下发给 LineMap 即时切换
    onSimSignboard(on) {
      this.simSignboard = setSimSignboard(!!on)
      uni.showToast({ title: this.simSignboard ? '已启用仿真站牌设计' : '已关闭仿真站牌设计', icon: 'none' })
    },
    // 极简站牌模式：只保留线路头 + 候车信息 + 站点序列，隐藏多余控件
    // 设置面板的「开启 / 关闭」与极简面板里的「✕ 退出极简」都走这里
    onMinStopsMode(on) {
      this.minStopsMode = setMinStopsMode(!!on)
      uni.showToast({ title: this.minStopsMode ? '已启用极简站牌' : '已关闭极简站牌', icon: 'none' })
    },
    // 复制线路走向图（仿真）：按当前方向渲染路线图为 PNG 再写入剪贴板
    onCopyRouteImg() {
      const c = this.$refs.stopsC
      if (c && typeof c.copyRouteImage === 'function') {
        c.copyRouteImage()
      } else {
        uni.showToast({ title: '走向图不可用', icon: 'none' })
      }
    },
    // 界面字体：写 <html> --app-font 全站即时跟随；本机持久化，启动自动恢复
    onFont(key) {
      this.uiFont = setFont(key)
      const opt = this.fontOpts.find((o) => o.key === key)
      uni.showToast({ title: `字体已切换：${opt ? opt.label : key}`, icon: 'none' })
    },
    // 刷新间隔（全站唯一真源）：写入后由 settings 广播到所有已挂载的刷新控件，
    // 无需再用 $refs 逐个推送；设置面板自身也通过订阅反向跟随其它控件的改动
    onRefreshDefault(sec) {
      this.refreshDefault = saveRefreshSec(sec)
      uni.showToast({ title: sec > 0 ? `刷新间隔：每 ${sec} 秒` : '刷新间隔：手动', icon: 'none' })
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
    // 修改登录密码：无需旧密码，仅校验两次新密码一致；成功后清空输入并标记已自定义
    onChangePwd() {
      if (!this.pwdNew || !this.pwdConfirm) {
        uni.showToast({ title: '请填写新密码', icon: 'none' })
        return
      }
      if (this.pwdNew !== this.pwdConfirm) {
        uni.showToast({ title: '两次输入的新密码不一致', icon: 'none' })
        return
      }
      const r = changePassword(this.account, this.pwdNew)
      if (!r.ok) {
        uni.showToast({ title: r.error || '修改失败', icon: 'none' })
        return
      }
      this.pwdNew = ''
      this.pwdConfirm = ''
      this.pwdCustom = true
      uni.showToast({ title: '密码已修改', icon: 'success' })
    },
    // 恢复默认口令：无需旧密码，直接恢复为预置口令
    onResetPwd() {
      const r = resetPassword(this.account)
      if (!r.ok) {
        uni.showToast({ title: r.error || '恢复失败', icon: 'none' })
        return
      }
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
  border-color: rgba(var(--ac-rgb), 0.6);
  background: rgba(var(--ac-rgb), 0.1);
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
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
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
/* 身份区：头像 + 用户名 + 账号名，头像作为视觉重心放大到 176rpx */
.acct-id {
  display: flex;
  align-items: center;
  gap: 28rpx;
  padding: 10rpx 0 22rpx;
}
/* 自定义头像：比原 120rpx 明显放大，多层光晕 + 渐变描边，让上传的图成为面板里最抢眼的一块 */
.acct-avatar {
  position: relative;
  flex: 0 0 auto;
  width: 176rpx;
  height: 176rpx;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(var(--ac-rgb), 0.45), rgba(var(--ac2-rgb), 0.32));
  border: 4rpx solid rgba(255, 255, 255, 0.18);
  box-shadow:
    0 0 0 6rpx rgba(var(--ac-rgb), 0.18),
    0 0 0 12rpx rgba(var(--ac-rgb), 0.10),
    0 18rpx 44rpx rgba(0, 0, 0, 0.45),
    inset 0 2rpx 0 rgba(255, 255, 255, 0.28);
  cursor: pointer;
  transition: transform 0.2s ease, filter 0.2s ease, box-shadow 0.2s ease;
}
.acct-avatar:hover {
  transform: scale(1.04);
  filter: brightness(1.08);
  box-shadow:
    0 0 0 6rpx rgba(var(--ac-rgb), 0.28),
    0 0 0 14rpx rgba(var(--ac-rgb), 0.14),
    0 22rpx 52rpx rgba(0, 0, 0, 0.55),
    inset 0 2rpx 0 rgba(255, 255, 255, 0.32);
}
.acct-avatar:active {
  transform: scale(0.97);
}
.acct-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.acct-avatar-txt {
  font-size: 72rpx;
  font-weight: 800;
  color: #eef1ff;
  text-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.4);
}
/* 悬浮相机角标：暗示「可点更换」，随头像一起放大 */
.acct-avatar-cam {
  position: absolute;
  right: -4rpx;
  bottom: -4rpx;
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  font-size: 26rpx;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, rgba(var(--ac-rgb), 0.98), rgba(var(--ac2-rgb), 0.85));
  border: 4rpx solid rgba(11, 16, 32, 0.92);
  box-shadow: 0 4rpx 14rpx rgba(0, 0, 0, 0.45);
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
  background: linear-gradient(135deg, var(--ac), var(--ac-hi));
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
  /* 行高放宽 + 底部余量：账号里的下划线（BOUNDLESS_558）画在基线之下，
     默认 normal 行高下会被 overflow: hidden 连同 descender 一起裁掉，看起来像空格 */
  line-height: 1.6;
  padding-bottom: 2rpx;
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
  background: rgba(var(--ac-rgb), 0.18);
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
/* 分区折叠头：标题 + 折叠态下的当前值摘要 + 旋转箭头，整行可点 */
.acct-sec-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 14rpx;
  padding: 6rpx 2rpx;
  cursor: pointer;
  user-select: none;
}
.acct-sec-head:active .acct-sec-title {
  color: #fff;
}
.acct-sec-title {
  font-size: 24rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.62);
  transition: color 0.15s;
}
.acct-sec-sum {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.38);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acct-sec-chev {
  flex: 0 0 auto;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.42);
  transition: transform 0.18s ease;
}
.acct-sec-chev.folded {
  transform: rotate(-90deg);
}
/* 展开区：轻微淡入 + 下滑，避免生硬闪现 */
.acct-sec-body {
  animation: acct-sec-in 0.18s ease-out;
}
@keyframes acct-sec-in {
  from { opacity: 0; transform: translateY(-6rpx); }
  to { opacity: 1; transform: translateY(0); }
}
/* 一键全收 / 全展 */
.acct-fold-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: 16rpx;
}
.acct-fold-hint {
  flex: 1;
  min-width: 0;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.32);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acct-fold-btn {
  flex: 0 0 auto;
  padding: 6rpx 16rpx;
  border-radius: 10rpx;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.acct-fold-btn:hover {
  color: #fff;
  background: rgba(var(--ac-rgb), 0.22);
}
/* 分段选择器（有效期 / 刷新 / 皮肤共用）：凹槽底 + 选中靛蓝胶囊 */
.acct-seg {
  display: flex;
  gap: 0;
  padding: 4rpx;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.acct-seg-item {
  flex: 1;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 11rpx;
  font-size: 23rpx;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: background 0.18s, color 0.18s, box-shadow 0.18s;
  white-space: nowrap;
}
.acct-seg-item:not(:last-child) {
  margin-right: 4rpx;
}
.acct-seg-item:hover {
  color: rgba(255, 255, 255, 0.8);
}
.acct-seg-item.on {
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, var(--ac), var(--ac-hi));
  box-shadow: 0 6rpx 16rpx rgba(var(--ac-rgb), 0.35);
}
/* 高德 KEY：申请引导 + 输入框 + 操作按钮 + 费用提示 */
.amap-apply {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.04);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.amap-apply-txt {
  flex: 1;
  font-size: 21rpx;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.7);
}
.amap-apply-link {
  flex: 0 0 auto;
  font-size: 22rpx;
  font-weight: 700;
  color: var(--ac-hi);
  cursor: pointer;
  white-space: nowrap;
}
.amap-input-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 14rpx;
  padding: 0 18rpx;
  height: 72rpx;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.04);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.amap-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 23rpx;
  color: #fff;
}
.amap-btn-row {
  display: flex;
  gap: 12rpx;
  margin-top: 16rpx;
}
.amap-btn {
  flex: 1;
  height: 60rpx;
  line-height: 60rpx;
  text-align: center;
  border-radius: 14rpx;
  font-size: 22rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.amap-btn:not(.primary):hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.amap-btn.primary {
  flex: 1.4;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, var(--ac), var(--ac-hi));
  box-shadow: 0 6rpx 16rpx rgba(var(--ac-rgb), 0.3);
}
/* 合并分区内的小标题 / 分隔 */
.amap-sub-label {
  font-size: 23rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
  margin: 6rpx 0 8rpx;
}
/* Key / 安全密钥两个输入框各自的小标题 */
.amap-field-label {
  font-size: 19rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  margin: 12rpx 0 6rpx;
}
.amap-sub-hint {
  display: block;
  font-size: 20rpx;
  font-weight: 400;
  color: rgba(var(--ac-rgb), 0.95);
  margin-bottom: 14rpx;
}
.amap-sub-div {
  height: 2rpx;
  margin: 28rpx 0 22rpx;
  background: rgba(255, 255, 255, 0.08);
}
/* 每日额度信息卡 */
.amap-quota {
  margin-top: 18rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.04);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.amap-quota-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.amap-quota-title {
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 1rpx;
}
.amap-quota-big {
  font-size: 40rpx;
  font-weight: 800;
  color: var(--ac-hi);
  line-height: 1;
}
.amap-quota-unit {
  font-size: 20rpx;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.55);
}
.amap-quota-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 6rpx 0;
}
.amap-quota-k {
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.5);
}
.amap-quota-v {
  font-size: 22rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}
.amap-quota-v.dim {
  font-size: 20rpx;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.45);
}
.amap-quota-link {
  display: block;
  margin-top: 12rpx;
  padding-top: 10rpx;
  border-top: 2rpx solid rgba(255, 255, 255, 0.06);
  font-size: 20rpx;
  color: var(--ac-hi);
  cursor: pointer;
}
/* 费用说明：独立卡片，长文更易读 */
.amap-note {
  margin-top: 16rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: rgba(255, 196, 128, 0.06);
  border: 2rpx solid rgba(255, 196, 128, 0.14);
  font-size: 20rpx;
  line-height: 1.6;
  color: rgba(255, 196, 128, 0.72);
}
/* 主题色行：预设色点 + 调色盘（彩虹锥形渐变标识） */
.ac-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  flex-wrap: wrap;
}
.ac-dot {
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(255, 255, 255, 0.22);
  box-sizing: border-box;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.ac-dot:hover {
  transform: scale(1.1);
}
.ac-dot.on {
  border-color: #ffffff;
  box-shadow: 0 0 0 4rpx rgba(var(--ac-rgb), 0.45);
  transform: scale(1.08);
}
.ac-picker {
  background: conic-gradient(#f43f5e, #f97316, #facc15, #4ade80, #22d3ee, #818cf8, #e879f9, #f43f5e);
  position: relative;
  transition: box-shadow 0.15s ease;
}
.ac-picker.open {
  box-shadow: 0 0 0 4rpx rgba(var(--ac-rgb), 0.85);
}

/* ── 内联 HSV 调色盘（仅 H5）── */
.cp-wrap {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 12rpx;
  padding: 12rpx 14rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
}
.cp-area {
  position: relative;
  width: 160rpx;
  height: 160rpx;
  border-radius: 10rpx;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
  flex-shrink: 0;
  /* CSS 双重渐变：水平白→色相，垂直透明→黑，合成 HSV 亮度/饱和度面 */
  background-image: linear-gradient(to right, #fff, var(--cp-hue-color, #ff0000)),
                    linear-gradient(to top, transparent, #000);
}
.cp-cursor {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  border: 3rpx solid #fff;
  box-shadow: 0 0 0 1.5rpx rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.cp-hue-bar {
  width: 44rpx;
  height: 160rpx;
  border-radius: 8rpx;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  touch-action: none;
  flex-shrink: 0;
  /* CSS 彩虹渐变带 */
  background: linear-gradient(to bottom,
    hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%),
    hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%));
}
.cp-hue-track {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.cp-hue-cursor {
  position: absolute;
  left: -4rpx;
  top: 50%;
  transform: translateY(-50%);
  width: calc(100% + 8rpx);
  height: 8rpx;
  border-radius: 4rpx;
  background: #fff;
  box-shadow: 0 1rpx 4rpx rgba(0,0,0,0.45);
  pointer-events: none;
}
.cp-preview {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
  flex: 1;
}
.cp-sw {
  width: 44rpx;
  height: 44rpx;
  border-radius: 8rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}
.cp-hex {
  font-size: 22rpx;
  font-family: 'Courier New', monospace;
  color: rgba(255, 255, 255, 0.72);
  letter-spacing: 0.5rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 界面字体：两列芯片网格；芯片内的字体名用真字体渲染当预览 */
.font-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}
.font-chip {
  flex: 1 1 calc(50% - 10rpx);
  min-width: calc(50% - 10rpx);
  box-sizing: border-box;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid transparent;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.font-chip:hover {
  background: rgba(255, 255, 255, 0.09);
}
.font-chip.on {
  background: rgba(var(--ac-rgb), 0.16);
  border-color: rgba(var(--ac-rgb), 0.55);
}
.font-chip-name {
  display: block;
  font-size: 28rpx;
  color: #fff;
  line-height: 1.3;
}
.font-chip-note {
  display: block;
  margin-top: 4rpx;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.45);
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
.acct-pwd-field {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 14rpx;
}
.acct-pwd-input {
  flex: 1;
  min-width: 0;
  font-weight: 400;
}
/* 眼睛按钮内嵌输入行右侧：单色描边 SVG，半透明常态，点亮表示明文可见 */
.acct-eye {
  flex: 0 0 auto;
  font-size: 32rpx;
  color: #fff;
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.15s;
}
.acct-eye.on {
  opacity: 1;
}
.acct-eye:active {
  transform: scale(0.9);
}
.acct-btn.save {
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac-hi));
  box-shadow: 0 10rpx 26rpx rgba(var(--ac-rgb), 0.35), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.acct-btn.save:hover {
  filter: brightness(1.08);
}
/* 实时线路窗头的「站牌」切换按钮：与 📌/✕ 等高（56rpx），胶囊描边，激活态用青蓝实心 */
.fw-act {
  height: 56rpx;
  line-height: 56rpx;
  padding: 0 22rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 0.4rpx;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  cursor: pointer;
  transition: background 0.18s, color 0.18s, border-color 0.18s, transform 0.12s;
}
.fw-act:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}
.fw-act.on {
  color: #06121f;
  background: linear-gradient(135deg, #67e8f9, #22d3ee);
  border-color: transparent;
  box-shadow: 0 6rpx 18rpx rgba(34, 211, 238, 0.4);
}
.fw-act:active {
  transform: scale(0.94);
}
</style>
