<template>
  <view class="map-page">
    <LineMap
      :line-code-prop="lineCode"
      :init-direction="direction"
      :line-name-prop="lineName"
      :embedded="false"
      ref="mapC"
    />
  </view>
</template>

<script>
// 独立地图页：仅作为 LineMap 组件的瘦包装，逻辑全部下沉到组件，避免重复。
// 生命周期转发给子组件，保持与原 map 页一致的行为（自动刷新 / 手势重绑 / 卸载清理）。
import LineMap from '../../components/LineMap.vue'

export default {
  components: { LineMap },
  data() {
    return {
      lineCode: '',
      direction: 0,
      lineName: '',
    }
  },
  onLoad(options) {
    this.lineCode = options.lineCode || ''
    this.direction = Number(options.direction || 0)
    this.lineName = options.lineName || ''
  },
  onShow() {
    const m = this.$refs.mapC
    if (!m) return
    m.restartAutoRefresh()
    this.$nextTick(() => {
      m.measureUi()
      m.bindGestures()
      m.bindHover()
    })
  },
  onHide() {
    const m = this.$refs.mapC
    if (m) m.stopAutoRefresh()
  },
  onUnload() {
    const m = this.$refs.mapC
    if (m) m.cleanup()
  },
}
</script>

<style scoped>
.map-page {
  position: fixed;
  inset: 0;
  /* H5 原生标题栏高度，避免内容被其遮挡 */
  padding-top: var(--window-top, 0px);
  box-sizing: border-box;
  background: #070b18;
}
</style>
