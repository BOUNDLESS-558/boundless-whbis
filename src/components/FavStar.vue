<template>
  <!-- 通用线路收藏按钮：高亮=已收藏，再点一次取消收藏并还原非高亮。
       挂载点覆盖搜索联想、实时线路、实时地图、全市公交、线路数据库等所有线路条目。 -->
  <view
    class="fav-star"
    :class="{ on: on, small: small }"
    :title="on ? '取消收藏该线路' : '收藏该线路（最多 10 条）'"
    @click.stop="toggle"
  >{{ on ? '★' : '☆' }}</view>
</template>

<script>
import { isFavorite, toggleFavorite, onFavoritesChange } from '../utils/favorites.js'

export default {
  name: 'FavStar',
  props: {
    // 线路摘要：至少要有 no；code/name/start/end/org 用于收藏夹里快速查询
    line: { type: Object, default: () => ({}) },
    small: { type: Boolean, default: false },
  },
  emits: ['change'],
  data() {
    return { on: false, off: null }
  },
  computed: {
    no() {
      const l = this.line || {}
      return String(l.no || l.lineName || l.lineNo || '').trim()
    },
  },
  watch: {
    no() { this.sync() },
  },
  created() {
    this.sync()
    // 任一处增删后，所有同线路的星标一起刷新高亮态
    this.off = onFavoritesChange(() => this.sync())
  },
  beforeUnmount() { if (this.off) this.off() },
  // uni-app Vue2 兼容：组件也可能走 destroyed 而非 beforeUnmount
  destroyed() { if (this.off) this.off() },
  methods: {
    sync() { this.on = isFavorite(this.no) },
    toggle() {
      if (!this.no) return
      const r = toggleFavorite(this.line || { no: this.no })
      if (!r.ok) {
        uni.showToast({ title: r.reason || '操作失败', icon: 'none' })
        return
      }
      this.on = r.added
      uni.showToast({ title: r.added ? `已收藏 ${this.no}` : `已取消收藏 ${this.no}`, icon: 'none' })
      this.$emit('change', { no: this.no, added: r.added, list: r.list })
    },
  },
}
</script>

<style scoped>
.fav-star {
  flex: 0 0 auto;
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  font-size: 32rpx;
  color: rgba(255, 255, 255, 0.38);
  border-radius: 12rpx;
  transition: color .15s, background .15s, transform .15s;
}
.fav-star:hover { color: #fbbf24; background: rgba(251, 191, 36, 0.1); }
.fav-star.on {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.16);
  text-shadow: 0 0 12rpx rgba(251, 191, 36, 0.55);
}
.fav-star.on:active { transform: scale(0.88); }
.fav-star.small { width: 36rpx; height: 36rpx; line-height: 36rpx; font-size: 26rpx; }
</style>
