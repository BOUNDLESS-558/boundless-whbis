<template>
  <view class="login">
    <view class="login-card">
      <!-- 品牌头：与 LineSearch 主卡同款 logo 底板与渐变标题 -->
      <view class="lc-head">
        <image class="lc-logo" :src="logoUrl" mode="aspectFit" />
        <view class="lc-title">武汉公交信息实时查询</view>
        <view class="lc-sub">在线营运线路 · 站点 · 实时车辆</view>
      </view>

      <view class="lc-field">
        <text class="lc-icon">👤</text>
        <input
          class="lc-input"
          v-model="account"
          type="text"
          placeholder="请输入账号"
          placeholder-class="lc-ph"
          confirm-type="next"
        />
      </view>

      <view class="lc-field">
        <text class="lc-icon">🔒</text>
        <input
          class="lc-input"
          v-model="password"
          :password="!showPass"
          placeholder="请输入密码（6~32 位）"
          placeholder-class="lc-ph"
          confirm-type="done"
          @confirm="submit"
        />
        <view class="lc-eye" :class="{ on: showPass }" @click="showPass = !showPass" v-html="showPass ? svgEyeOn : svgEyeOff" />
      </view>

      <view class="lc-btn" :class="{ busy }" @click="submit">
        {{ busy ? '处理中…' : '登 录' }}
      </view>
    </view>

    <!-- 纯前端门槛说明（诚实标注，不装安全机制） -->
    <view class="lc-note">账号由管理员预置，密码按规则校验；仅存于本机会话，属使用门槛而非安全机制</view>
  </view>
</template>

<script>
import { assetUrl } from '../../utils/asset.js'
import { login, isLoggedIn } from '../../utils/auth.js'

const HOME = '/pages/map/map'

export default {
  name: 'LoginPage',
  data() {
    return {
      account: '',
      password: '',
      showPass: false,
      // 眼睛图标：单色描边 SVG，跟随文字色（currentColor）、1em 尺寸，避免彩色 emoji 突兀
      svgEyeOn: '<svg viewBox="0 0 24 24" width="1em" height="1em" style="display:block" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.2 10-6.2S22 12 22 12s-3.5 6.2-10 6.2S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>',
      svgEyeOff: '<svg viewBox="0 0 24 24" width="1em" height="1em" style="display:block" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 16 16"/><path d="M9.9 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-2.7 3.5M6.3 6.5A16.4 16.4 0 0 0 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4.4-.9"/><path d="M9.9 9.9a2.9 2.9 0 0 0 4.2 4.2"/></svg>',
      busy: false,
    }
  },
  computed: {
    logoUrl() {
      return assetUrl('/static/logo.png')
    },
  },
  onLoad(query) {
    // 已登录还进登录页（回退 / 直接改地址栏）→ 直接放行首页
    if (isLoggedIn()) {
      uni.reLaunch({ url: HOME })
    }
  },
  methods: {
    async submit() {
      if (this.busy) return
      this.busy = true
      try {
        const r = await login(this.account, this.password)
        if (!r.ok) {
          uni.showToast({ title: r.error || '登录失败', icon: 'none' })
          return
        }
        uni.showToast({ title: '欢迎回来', icon: 'success', duration: 800 })
        this.goAfterLogin()
      } finally {
        this.busy = false
      }
    },
    goAfterLogin() {
      // H5 带 redirect 时登录后原位恢复；App 端无此参数，直接进首页。
      // 自己从 hash 里取：uni 会把 query 值再编一层，页内 options 里是双重编码，解读不可靠
      // #ifdef H5
      const m = /[?&]redirect=([^&]+)/.exec(window.location.hash || '')
      if (m) {
        try {
          // 兼容单层/双层编码（uni 会把 query 值再编一层进入口页 hash）
          let target = decodeURIComponent(m[1])
          if (!/^\/pages\//.test(target)) target = decodeURIComponent(target)
          if (/^\/pages\//.test(target)) {
            uni.reLaunch({ url: target })
            return
          }
        } catch (e) { /* 坏值当没有，落首页 */ }
      }
      // #endif
      uni.reLaunch({ url: HOME })
    },
  },
}
</script>

<style>
/* 页面底：App.vue 的 page 全局背景在这里继续生效，本层只负责居中布局 */
.login {
  min-height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
}
/* 玻璃卡片：与 .mod 主卡同一套毛玻璃口径 */
.login-card {
  width: 100%;
  max-width: 640rpx;
  box-sizing: border-box;
  padding: 48rpx 40rpx 36rpx;
  border-radius: 32rpx;
  background: rgba(17, 22, 33, 0.86);
  backdrop-filter: blur(30px) saturate(170%);
  -webkit-backdrop-filter: blur(30px) saturate(170%);
  border: 2rpx solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 26rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.08);
}
/* ---- 品牌头 ---- */
.lc-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 36rpx;
}
.lc-logo {
  width: 120rpx;
  height: 120rpx;
  padding: 12rpx;
  box-sizing: border-box;
  border-radius: 28rpx;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.06));
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 12rpx 30rpx rgba(0, 0, 0, 0.32), inset 0 1rpx 0 rgba(255, 255, 255, 0.22);
}
.lc-title {
  margin-top: 22rpx;
  font-size: 40rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
  background: linear-gradient(120deg, #ffffff 0%, #dbe4ff 45%, #a5f3fc 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lc-sub {
  margin-top: 10rpx;
  font-size: 22rpx;
  letter-spacing: 1rpx;
  color: rgba(255, 255, 255, 0.45);
}
/* ---- 输入行（凹槽同款） ---- */
.lc-field {
  margin-top: 24rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 84rpx;
  padding: 0 22rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  border-radius: 20rpx;
  transition: background 0.2s, border-color 0.2s;
}
.lc-field:focus-within {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(34, 211, 238, 0.45);
}
.lc-icon {
  flex: 0 0 auto;
  font-size: 28rpx;
  opacity: 0.7;
}
.lc-input {
  flex: 1;
  min-width: 0;
  height: 76rpx;
  line-height: 76rpx;
  font-size: 28rpx;
  color: #fff;
}
.lc-ph {
  color: rgba(255, 255, 255, 0.35);
}
.lc-eye {
  flex: 0 0 auto;
  padding: 0 6rpx;
  font-size: 32rpx;
  color: #fff;
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.15s;
}
.lc-eye.on {
  opacity: 1;
}
/* ---- 主按钮（.search-btn 同款渐变） ---- */
.lc-btn {
  margin-top: 36rpx;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 22rpx;
  text-align: center;
  font-size: 30rpx;
  font-weight: 800;
  letter-spacing: 6rpx;
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  box-shadow: 0 10rpx 26rpx rgba(79, 110, 247, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: transform 0.15s, filter 0.2s;
}
.lc-btn:hover {
  filter: brightness(1.08);
}
.lc-btn:active {
  transform: scale(0.97);
}
.lc-btn.busy {
  filter: brightness(0.7);
  pointer-events: none;
}
/* ---- 底部切换 ---- */
.lc-foot {
  margin-top: 26rpx;
  text-align: center;
}
.lc-foot-t {
  font-size: 23rpx;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}
.lc-foot-t:hover {
  color: rgba(165, 243, 252, 0.9);
}
/* ---- 门槛说明 ---- */
.lc-note {
  margin-top: 28rpx;
  max-width: 640rpx;
  text-align: center;
  font-size: 20rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.3);
}
</style>
