<template>
  <!-- 线路收藏夹：最多 10 条。点一条直达实时公交查询；每条可单独移除。 -->
  <view class="fav-panel" :class="{ 'is-plain': plain }">
    <!-- 概览条：plain 形态（FloatWin 内）标题由窗体给，这里只留统计与进度 -->
    <view class="fp-hero">
      <view class="fp-hero-ico">★</view>
      <view class="fp-hero-txt">
        <text class="fp-title" v-if="!plain">线路收藏夹</text>
        <text class="fp-sub">{{ subText }}</text>
      </view>
      <view class="fp-count">
        <text class="fp-count-n">{{ list.length }}</text>
        <text class="fp-count-d">/ {{ max }}</text>
      </view>
    </view>

    <!-- 容量进度：一眼看出还能收几条 -->
    <view class="fp-bar"><view class="fp-bar-in" :style="{ width: progress }"></view></view>

    <view class="fp-tools">
      <text class="fp-hint">点一条直达实时公交 · 最多 {{ max }} 条</text>
      <view class="fp-clear" v-if="list.length" @click="clear">清空</view>
    </view>

    <view class="fp-list" v-if="list.length">
      <view class="fp-item" v-for="(it, i) in list" :key="it.no" @click="pick(it)">
        <view class="fp-stripe" :style="{ background: colorOf(it) }"></view>
        <text class="fp-idx">{{ idxOf(i) }}</text>
        <view class="fp-logo">
          <image v-if="logoOf(it)" class="fp-logo-img" :src="logoOf(it)" mode="aspectFit" />
          <text v-else class="fp-logo-t" :style="{ color: colorOf(it) }">{{ shortOf(it) }}</text>
        </view>
        <view class="fp-body">
          <view class="fp-no-row">
            <text class="fp-no">{{ it.no }}</text>
            <text class="fp-org" v-if="orgOf(it)">{{ orgOf(it) }}</text>
          </view>
          <text class="fp-route">{{ it.start || '起点未知' }} → {{ it.end || '终点未知' }}</text>
        </view>
        <view class="fp-rm" title="移除收藏" @click.stop="remove(it)">✕</view>
        <text class="fp-go">›</text>
      </view>
    </view>

    <!-- 空态：光环 + 入口引导，不再是一行干巴巴的提示 -->
    <view class="fp-empty" v-else>
      <view class="fp-empty-glow"><text class="fp-empty-ico">☆</text></view>
      <text class="fp-empty-t">还没有收藏线路</text>
      <text class="fp-empty-s">把常坐的线路收进来，下次一点就能查询实时公交</text>
      <view class="fp-where-row">
        <view class="fp-where"><text class="fp-where-i">⌕</text>搜索联想</view>
        <view class="fp-where"><text class="fp-where-i">◉</text>实时公交</view>
        <view class="fp-where"><text class="fp-where-i">▤</text>线路库</view>
      </view>
      <text class="fp-empty-tip">点线路旁的 ☆ 即可加入</text>
    </view>

    <view class="fp-foot" v-if="list.length">
      <text class="fp-foot-i">i</text>
      高德数据源线路仅提供静态站点与走向，不含实时车辆
    </view>
  </view>
</template>

<script>
import { getFavorites, removeFavorite, clearFavorites, onFavoritesChange, toPick, FAV_MAX } from '../utils/favorites.js'
import { companyOf } from '../utils/companies.js'
import { assetUrl } from '../utils/asset.js'

export default {
  name: 'FavPanel',
  emits: ['pick'],
  // plain：并入宿主窗体内（标题由宿主给），此时不重复渲染「线路收藏夹」标题
  props: { plain: { type: Boolean, default: false } },
  data() {
    return { list: [], max: FAV_MAX, off: null }
  },
  computed: {
    progress() {
      return (this.max ? Math.min(100, (this.list.length / this.max) * 100) : 0) + '%'
    },
    subText() {
      return this.list.length ? `已收藏 ${this.list.length} 条常用线路` : '把常坐的线路放在手边'
    },
  },
  created() {
    this.sync()
    this.off = onFavoritesChange(() => this.sync())
  },
  beforeUnmount() { if (this.off) this.off() },
  destroyed() { if (this.off) this.off() },
  methods: {
    sync() { this.list = getFavorites() },
    // 模板里不直接用全局构造函数（uni-app 跨端模板编译对 String 支持不稳）
    idxOf(i) { return String(i + 1).padStart(2, '0') },
    logoOf(it) {
      return assetUrl(companyOf(it).logo)
    },
    colorOf(it) {
      return companyOf(it).color
    },
    shortOf(it) {
      return companyOf(it).label.slice(0, 2)
    },
    orgOf(it) {
      return companyOf(it).label
    },
    remove(it) {
      this.list = removeFavorite(it.no)
      uni.showToast({ title: `已移除 ${it.no}`, icon: 'none' })
    },
    clear() {
      this.list = clearFavorites()
      uni.showToast({ title: '收藏夹已清空', icon: 'none' })
    },
    pick(it) {
      this.$emit('pick', toPick(it))
    },
  },
}
</script>

<style scoped>
/* 收藏夹：概览条 + 容量进度 + 卡片列表 / 空态光环。
   非 plain（落地页）自带卡壳；plain（FloatWin 内）沿用窗体卡壳，只留内边距，避免套娃。 */
.fav-panel { padding: 26rpx 28rpx 28rpx; }
.fav-panel:not(.is-plain) {
  background: rgba(11, 16, 32, 0.88);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  border-radius: 28rpx;
  box-shadow: 0 18rpx 48rpx rgba(0, 0, 0, 0.32), inset 0 1rpx 0 rgba(255, 255, 255, 0.14);
}

/* ── 概览条 ── */
.fp-hero { display: flex; align-items: center; gap: 18rpx; }
.fp-hero-ico {
  flex: 0 0 auto; width: 68rpx; height: 68rpx; border-radius: 20rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 34rpx; color: #fff;
  background: linear-gradient(135deg, rgba(var(--ac-rgb), 0.95), rgba(var(--ac-rgb), 0.42));
  box-shadow: 0 8rpx 22rpx rgba(var(--ac-rgb), 0.26);
}
.fp-hero-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.fp-title { font-size: 30rpx; font-weight: 700; color: #f1f5f9; letter-spacing: 1rpx; }
.fp-sub { font-size: 21rpx; color: rgba(255, 255, 255, 0.46); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-count {
  flex: 0 0 auto; display: flex; align-items: baseline; gap: 4rpx;
  padding: 8rpx 18rpx; border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
}
.fp-count-n { font-size: 32rpx; font-weight: 800; color: var(--ac-text, #67e8f9); line-height: 1; }
.fp-count-d { font-size: 20rpx; color: rgba(255, 255, 255, 0.42); }

/* ── 容量进度 ── */
.fp-bar {
  height: 6rpx; margin: 20rpx 0 16rpx; border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.08); overflow: hidden;
}
.fp-bar-in {
  height: 100%; border-radius: 999rpx;
  background: linear-gradient(90deg, rgba(var(--ac-rgb), 0.55), var(--ac, #67e8f9));
  transition: width 0.3s ease;
}

/* ── 工具行 ── */
.fp-tools { display: flex; align-items: center; gap: 12rpx; margin-bottom: 20rpx; }
.fp-hint { flex: 1 1 auto; min-width: 0; font-size: 21rpx; color: rgba(255, 255, 255, 0.4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-clear {
  flex: 0 0 auto; font-size: 21rpx; color: #fda4af;
  padding: 6rpx 18rpx; border-radius: 999rpx;
  background: rgba(244, 63, 94, 0.1);
  border: 2rpx solid rgba(244, 63, 94, 0.22);
  cursor: pointer;
}
.fp-clear:active { transform: scale(0.94); }

/* ── 收藏列表 ── */
.fp-list { display: flex; flex-direction: column; gap: 12rpx; }
.fp-item {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 14rpx;
  padding: 18rpx 18rpx 18rpx 22rpx; border-radius: 18rpx;
  background: rgba(255, 255, 255, 0.045);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, transform 0.18s;
}
.fp-item:hover {
  background: rgba(255, 255, 255, 0.075);
  border-color: rgba(var(--ac-rgb), 0.4);
  transform: translateY(-2rpx);
}
.fp-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 6rpx; opacity: 0.85; }
.fp-idx { flex: 0 0 auto; font-size: 20rpx; color: rgba(255, 255, 255, 0.28); font-variant-numeric: tabular-nums; }
.fp-logo {
  flex: 0 0 auto; width: 54rpx; height: 54rpx; border-radius: 14rpx;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: inset 0 0 0 2rpx rgba(0, 0, 0, 0.06);
}
.fp-logo-img { width: 44rpx; height: 44rpx; }
.fp-logo-t { font-size: 20rpx; font-weight: 800; }
.fp-body { flex: 1 1 auto; min-width: 0; }
.fp-no-row { display: flex; align-items: baseline; gap: 12rpx; }
.fp-no { font-size: 30rpx; font-weight: 700; color: #e2e8f0; }
.fp-org {
  font-size: 19rpx; color: rgba(255, 255, 255, 0.52);
  padding: 2rpx 10rpx; border-radius: 999rpx; background: rgba(255, 255, 255, 0.07);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fp-route { display: block; font-size: 22rpx; color: rgba(255, 255, 255, 0.55); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 6rpx; }
.fp-rm {
  flex: 0 0 auto; width: 44rpx; height: 44rpx; line-height: 44rpx; text-align: center;
  font-size: 22rpx; border-radius: 50%; color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.05); cursor: pointer;
}
.fp-rm:hover { color: #fda4af; background: rgba(244, 63, 94, 0.16); }
.fp-go { flex: 0 0 auto; font-size: 32rpx; color: rgba(255, 255, 255, 0.3); }

/* ── 空态 ── */
.fp-empty { display: flex; flex-direction: column; align-items: center; padding: 48rpx 0 36rpx; }
.fp-empty-glow {
  width: 148rpx; height: 148rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle, rgba(var(--ac-rgb), 0.18) 0%, rgba(var(--ac-rgb), 0.04) 60%, transparent 72%);
  border: 2rpx solid rgba(var(--ac-rgb), 0.16);
  margin-bottom: 26rpx;
}
.fp-empty-ico { font-size: 68rpx; line-height: 1; color: rgba(var(--ac-rgb), 0.55); }
.fp-empty-t { font-size: 30rpx; font-weight: 700; color: rgba(255, 255, 255, 0.86); }
.fp-empty-s { font-size: 22rpx; color: rgba(255, 255, 255, 0.44); margin-top: 10rpx; text-align: center; line-height: 1.6; }
.fp-where-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 12rpx; margin-top: 28rpx; }
.fp-where {
  display: flex; align-items: center; gap: 8rpx;
  font-size: 21rpx; color: rgba(255, 255, 255, 0.62);
  padding: 10rpx 20rpx; border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.09);
}
.fp-where-i { font-size: 22rpx; color: var(--ac-text, #67e8f9); }
.fp-empty-tip { font-size: 20rpx; color: rgba(255, 255, 255, 0.3); margin-top: 22rpx; }

/* ── 底部说明 ── */
.fp-foot {
  display: flex; align-items: center; gap: 10rpx;
  font-size: 20rpx; color: rgba(255, 255, 255, 0.36);
  margin-top: 22rpx; padding-top: 18rpx;
  border-top: 2rpx solid rgba(255, 255, 255, 0.07);
  line-height: 1.5;
}
.fp-foot-i {
  flex: 0 0 auto; width: 28rpx; height: 28rpx; line-height: 28rpx; text-align: center;
  border-radius: 50%; font-size: 18rpx; font-style: normal;
  color: rgba(255, 255, 255, 0.6); border: 2rpx solid rgba(255, 255, 255, 0.24);
}
</style>
