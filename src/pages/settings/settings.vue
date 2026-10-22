<template>
  <view class="page">
    <view class="card glass">
      <view class="title">地图服务设置</view>
      <view class="desc">
        实时地图使用高德「Web端(JS API)」。填入你自己申请的 Key 后，地图用量计入你的高德账号；
        留空则使用内置 Key（开发模式）。
      </view>

      <view class="field">
        <view class="label">高德 JS Key</view>
        <input
          class="input"
          v-model="amapKey"
          type="text"
          placeholder="32 位小写字母 + 数字"
          placeholder-class="ph"
        />
      </view>
      <view class="field">
        <view class="label">安全密钥 securityJsCode</view>
        <input
          class="input"
          v-model="amapJsCode"
          type="text"
          placeholder="与 Key 配对的安全密钥"
          placeholder-class="ph"
        />
      </view>

      <view class="state" v-if="hasCustom">
        <text class="state-dot"></text>当前已启用自定义 Key：{{ maskedKey }}
      </view>

      <view class="btns">
        <view class="btn primary" @click="save">保存并重载</view>
        <view class="btn" v-if="hasCustom" @click="clear">清除自定义</view>
      </view>

      <view class="help">
        <view class="help-title">如何获取（约 2 分钟）</view>
        <view class="help-step">1. 打开高德开放平台控制台 console.amap.com，登录后进入「应用管理 → 我的应用」；</view>
        <view class="help-step">2. 创建新 Key，「启用平台」选择 <text class="em">Web端(JS API)</text>；</view>
        <view class="help-step">3. 域名白名单可留空（留空表示不限制来源）；</view>
        <view class="help-step">4. 把生成的 Key 和配套「安全密钥」复制粘贴到上方，保存后页面会自动重载生效。</view>
      </view>
    </view>
  </view>
</template>

<script>
import { getUserAmapConfig, saveUserAmapConfig, clearUserAmapConfig } from '../../config.js'

export default {
  data() {
    return {
      amapKey: '',
      amapJsCode: '',
      hasCustom: false,
    }
  },
  computed: {
    maskedKey() {
      const k = this.amapKey
      if (!k || k.length < 10) return k
      return `${k.slice(0, 4)}****${k.slice(-4)}`
    },
  },
  onLoad() {
    const c = getUserAmapConfig()
    if (c) {
      this.amapKey = c.key || ''
      this.amapJsCode = c.securityJsCode || ''
      this.hasCustom = true
    }
  },
  methods: {
    save() {
      const key = (this.amapKey || '').trim()
      const jscode = (this.amapJsCode || '').trim()
      if (!key) {
        uni.showToast({ title: '请输入高德 Key', icon: 'none' })
        return
      }
      saveUserAmapConfig({ key, securityJsCode: jscode })
      this.reload()
    },
    clear() {
      clearUserAmapConfig()
      this.amapKey = ''
      this.amapJsCode = ''
      this.hasCustom = false
      this.reload()
    },
    // 高德 SDK 一经加载无法换 Key，必须整页重载
    reload() {
      // #ifdef H5
      uni.showToast({ title: '已保存，正在重载...', icon: 'none' })
      setTimeout(() => window.location.reload(), 400)
      // #endif
      // #ifndef H5
      uni.showToast({ title: 'App 端地图 Key 随安装包内置，无需配置', icon: 'none' })
      // #endif
    },
  },
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 40rpx 32rpx 80rpx;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.glass {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.05));
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 32rpx;
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.20);
}
.card {
  width: 100%;
  max-width: 860rpx;
  padding: 44rpx 40rpx;
  box-sizing: border-box;
}
.title {
  font-size: 40rpx;
  font-weight: 800;
  color: #fff;
  margin-bottom: 16rpx;
}
.desc {
  font-size: 24rpx;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 36rpx;
}
.field {
  margin-bottom: 28rpx;
}
.label {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 12rpx;
}
.input {
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  border-radius: 20rpx;
  padding: 20rpx 26rpx;
  font-size: 28rpx;
  color: #fff;
}
.input:focus {
  border-color: rgba(129, 140, 248, 0.55);
}
.ph {
  color: rgba(255, 255, 255, 0.35);
}
.state {
  display: flex;
  align-items: center;
  font-size: 24rpx;
  color: #67e8f9;
  margin: 6rpx 0 28rpx;
}
.state-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #22d3ee;
  margin-right: 12rpx;
}
.btns {
  display: flex;
  gap: 24rpx;
  margin: 12rpx 0 40rpx;
}
.btn {
  flex: 1;
  text-align: center;
  font-size: 28rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 999rpx;
  padding: 22rpx 0;
  cursor: pointer;
  transition: transform 0.15s, background 0.2s;
}
.btn:active {
  transform: scale(0.97);
}
.btn.primary {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border: none;
  box-shadow: 0 14rpx 34rpx rgba(99, 102, 241, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}
.help {
  border-top: 2rpx solid rgba(255, 255, 255, 0.1);
  padding-top: 28rpx;
}
.help-title {
  font-size: 26rpx;
  font-weight: 700;
  color: #a5b4fc;
  margin-bottom: 16rpx;
}
.help-step {
  font-size: 23rpx;
  line-height: 1.9;
  color: rgba(255, 255, 255, 0.55);
}
.em {
  color: #fcd34d;
  font-weight: 600;
}
</style>
