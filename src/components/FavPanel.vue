<template>
  <!-- 线路收藏夹：最多 10 条。点一条直达实时公交查询；每条可单独移除。 -->
  <view class="fav-panel">
    <view class="fp-head">
      <text class="fp-title">线路收藏夹</text>
      <text class="fp-count">{{ list.length }} / {{ max }}</text>
      <view class="fp-clear" v-if="list.length" @click="clear">清空</view>
    </view>
    <view class="fp-tip">收藏常用线路，点一条即可查询实时公交；高德数据源线路仅提供静态站点与走向</view>

    <view class="fp-list" v-if="list.length">
      <view class="fp-item" v-for="it in list" :key="it.no" @click="pick(it)">
        <image v-if="logoOf(it)" class="fp-logo" :src="logoOf(it)" mode="aspectFit" />
        <view class="fp-badge" v-else :style="{ background: colorOf(it) }">{{ shortOf(it) }}</view>
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
    <view class="fp-empty" v-else>
      <text class="fp-empty-ico">☆</text>
      <text class="fp-empty-t">还没有收藏线路</text>
      <text class="fp-empty-s">在搜索联想、实时公交或线路库点 ☆ 即可加入</text>
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
  data() {
    return { list: [], max: FAV_MAX, off: null }
  },
  created() {
    this.sync()
    this.off = onFavoritesChange(() => this.sync())
  },
  beforeUnmount() { if (this.off) this.off() },
  destroyed() { if (this.off) this.off() },
  methods: {
    sync() { this.list = getFavorites() },
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
.fav-panel { padding: 4rpx 0 8rpx; }
.fp-head { display: flex; align-items: center; gap: 14rpx; }
.fp-title { font-size: 30rpx; font-weight: 600; color: #f1f5f9; }
.fp-count { font-size: 22rpx; color: rgba(255, 255, 255, 0.5); }
.fp-clear { margin-left: auto; font-size: 22rpx; color: #fda4af; padding: 6rpx 16rpx; border-radius: 10rpx; background: rgba(244, 63, 94, 0.12); }
.fp-tip { font-size: 21rpx; color: rgba(255, 255, 255, 0.42); margin: 10rpx 0 18rpx; line-height: 1.5; }
.fp-list { display: flex; flex-direction: column; gap: 10rpx; }
.fp-item {
  display: flex; align-items: center; gap: 14rpx;
  padding: 16rpx 14rpx; border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.045);
  border: 2rpx solid rgba(255, 255, 255, 0.07);
}
.fp-logo { width: 48rpx; height: 48rpx; flex: 0 0 auto; border-radius: 12rpx; }
.fp-badge {
  flex: 0 0 auto; width: 48rpx; height: 48rpx; border-radius: 12rpx;
  color: #fff; font-size: 19rpx; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.fp-body { flex: 1 1 auto; min-width: 0; }
.fp-no-row { display: flex; align-items: baseline; gap: 12rpx; }
.fp-no { font-size: 30rpx; font-weight: 700; color: #e2e8f0; }
.fp-org { font-size: 20rpx; color: rgba(255, 255, 255, 0.5); }
.fp-route { display: block; font-size: 22rpx; color: rgba(255, 255, 255, 0.58); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4rpx; }
.fp-rm { flex: 0 0 auto; font-size: 24rpx; color: rgba(255, 255, 255, 0.35); padding: 8rpx; }
.fp-rm:hover { color: #fda4af; }
.fp-go { flex: 0 0 auto; font-size: 32rpx; color: rgba(255, 255, 255, 0.3); }
.fp-empty { display: flex; flex-direction: column; align-items: center; padding: 60rpx 0; gap: 10rpx; }
.fp-empty-ico { font-size: 72rpx; color: rgba(255, 255, 255, 0.16); }
.fp-empty-t { font-size: 28rpx; color: rgba(255, 255, 255, 0.6); }
.fp-empty-s { font-size: 22rpx; color: rgba(255, 255, 255, 0.35); }
</style>
