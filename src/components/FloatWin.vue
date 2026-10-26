<template>
  <!-- 地图上的通用悬浮窗：与车辆详情窗（.bus-sheet）同一套视觉与交互 ——
       标题栏是拖动手柄（触摸走模板事件、鼠标走原生监听），📌 锁定位置、✕ 关闭由宿主决定；
       不带遮罩 —— 窗口开着时地图照样能拖拽缩放 -->
  <view class="float-win" :class="{ dragging, pinned, ready: !!pos }" :style="winStyle" :id="domId">
    <view
      class="fw-head"
      :title="pinned ? '已固定，点 📌 解锁后可拖动' : '按住标题栏拖动窗口'"
      @touchstart.stop="down"
      @touchmove.stop.prevent="move"
      @touchend.stop="up"
      @touchcancel.stop="up"
    >
      <text class="fw-grip">⣿</text>
      <text class="fw-title">{{ title }}</text>
      <text class="fw-sub" v-if="sub">{{ sub }}</text>
      <view class="fw-actions">
        <view
          class="fw-pin"
          :class="{ on: pinned }"
          @click.stop="togglePin"
          :title="pinned ? '取消固定（恢复拖动）' : '固定位置（锁定拖动）'"
        >📌</view>
        <view class="fw-close" @click.stop="close" title="关闭">✕</view>
      </view>
    </view>
    <view class="fw-body">
      <slot />
    </view>
  </view>
</template>

<script>
// 夹在视口内的最小边距（px），免得拖远后窗口找不回来
const PAD = 6

export default {
  name: 'FloatWin',
  props: {
    title: { type: String, default: '' },
    // 标题栏右侧的弱化说明（如「共 29 站」）
    sub: { type: String, default: '' },
    // 窗宽（rpx）：由 uni.upx2px 换算，默认定位与限幅都要用同一个数值
    widthRpx: { type: Number, default: 900 },
    maxHeight: { type: String, default: '74vh' },
  },
  emits: ['close'],
  data() {
    return {
      // 拖动后的像素位置（null = 用 CSS 默认位置）。
      // y 为 null 表示仍靠 CSS 的 bottom 锚定：窗口内容异步变高时只会往上长，不会掉出屏幕下沿
      pos: null,
      dragging: false,
      // 固定：锁定当前位置（标题栏不再响应拖动），再点一次解锁
      pinned: false,
      // 原生监听要挂在具体 DOM 上，同屏可能有多扇窗，故给根节点一个唯一 id
      domId: 'fw-' + Math.random().toString(36).slice(2, 8),
    }
  },
  computed: {
    widthPx() {
      return Math.round(uni.upx2px(this.widthRpx))
    },
    winStyle() {
      const st = { width: this.widthPx + 'px', maxHeight: this.maxHeight }
      if (this.pos) {
        st.left = this.pos.x + 'px'
        // 只有拖过之后才改成 top 锚定（拖之前一律贴底）
        if (this.pos.y != null) {
          st.top = this.pos.y + 'px'
          st.bottom = 'auto'
        }
      }
      return st
    },
  },
  mounted() {
    this.bindDrag()
    // 默认位置由 JS 量完实体再写死：根节点上不能留 transform，
    // 否则窗口会变成内部 fixed 后代（线路库详情弹层 / 刷新下拉遮罩）的包含块，弹层就被锁在窗口里
    this.center()
    if (typeof window !== 'undefined') window.addEventListener('resize', this.reclamp)
  },
  beforeUnmount() {
    this.unbindDrag()
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.reclamp)
  },
  methods: {
    // 指针坐标（客户端坐标系；鼠标与触摸事件都兼容）
    _point(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e
      if (!t) return null
      const x = t.clientX != null ? t.clientX : t.x
      const y = t.clientY != null ? t.clientY : t.y
      if (x == null || y == null) return null
      return { x, y }
    },
    clampX(x, w) {
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 375
      return Math.min(Math.max(x, PAD), Math.max(PAD, vw - w - PAD))
    },
    clampY(y, h) {
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 667
      return Math.min(Math.max(y, PAD), Math.max(PAD, vh - h - PAD))
    },
    // ✕ / 📌 点下去刚好是拖动起手那一下时不该生效
    close() {
      if (this._suppress) return
      this.$emit('close')
    },
    // 固定：锁定当前位置（标题栏不再响应拖动），再点一次解锁
    togglePin() {
      if (this._suppress) return
      this.pinned = !this.pinned
      uni.showToast({ title: this.pinned ? '已固定位置，点 📌 可解锁拖动' : '已解锁，可拖动', icon: 'none' })
    },
    // 开始拖动：记住指针相对窗口左上角的偏移，之后按绝对位置移动（窗口不会跳）
    down(e) {
      if (this.pinned) return
      // 按在右侧动作键上不算拖动起手，否则一点 ✕ 就顺手把窗推走了
      if (e.target && e.target.closest && e.target.closest('.fw-actions')) return
      if (e.type === 'mousedown' && Date.now() - (this._lastTouch || 0) < 700) return
      if (e.type === 'touchstart') this._lastTouch = Date.now()
      const rect = this._rootEl && this._rootEl.getBoundingClientRect
        ? this._rootEl.getBoundingClientRect()
        : null
      const p = this._point(e)
      if (!rect || !p) return
      this._drag = { ox: p.x - rect.left, oy: p.y - rect.top, w: rect.width, h: rect.height, x0: p.x, y0: p.y, moved: false }
      // 拖动后改走 top 锚定（用户放哪儿就是哪儿，不再被内容高度往下推）
      this.pos = { x: rect.left, y: rect.top }
      this.dragging = true
      // 鼠标拖动时指针很容易离开标题栏，监听挂到 document 上；触摸事件本身会重定向到起始元素
      if (e.type === 'mousedown' && typeof document !== 'undefined') {
        document.addEventListener('mousemove', this.move)
        document.addEventListener('mouseup', this.up)
      }
    },
    move(e) {
      const d = this._drag
      if (!d || this.pinned) return
      if (e.cancelable) e.preventDefault()
      const p = this._point(e)
      if (!p) return
      if (!d.moved && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) < 3) return
      d.moved = true
      this.pos = { x: this.clampX(p.x - d.ox, d.w), y: this.clampY(p.y - d.oy, d.h) }
    },
    up() {
      const d = this._drag
      this._drag = null
      this.dragging = false
      // 拖动收尾那一下的 click 不该按到 📌 / ✕
      if (d && d.moved) {
        this._suppress = true
        setTimeout(() => { this._suppress = false }, 120)
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousemove', this.move)
        document.removeEventListener('mouseup', this.up)
      }
    },
    // 原生绑定：uni-app H5 对 view 的 mouse 事件绑定不可靠，标题栏拖动直接用 DOM 监听
    bindDrag() {
      if (typeof document === 'undefined') return
      const el = document.getElementById(this.domId)
      const head = el && el.querySelector('.fw-head')
      if (!el || !head) return
      this._rootEl = el
      this._headEl = head
      head.style.touchAction = 'none'
      head.addEventListener('mousedown', this.down)
    },
    unbindDrag() {
      if (this._headEl) this._headEl.removeEventListener('mousedown', this.down)
      this._headEl = null
      this._rootEl = null
      this._drag = null
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousemove', this.move)
        document.removeEventListener('mouseup', this.up)
      }
    },
    // 首次打开：只水平居中（纵向仍由 CSS 贴底），高度交给内容自己长
    center() {
      if (this.pos) return
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 375
      const r = this._rootEl && this._rootEl.getBoundingClientRect
        ? this._rootEl.getBoundingClientRect()
        : null
      // 量不到实体时按窗宽估算，不能让窗口因为定位算不出来而一直隐着
      const w = r ? r.width : Math.min(this.widthPx, vw - PAD * 2)
      this.pos = { x: this.clampX((vw - w) / 2, w), y: null }
    },
    // 视口尺寸变化后重新收进屏幕（贴底态只修横向）
    reclamp() {
      if (!this.pos || !this._rootEl) return
      const r = this._rootEl.getBoundingClientRect()
      this.pos = {
        x: this.clampX(this.pos.x, r.width),
        y: this.pos.y == null ? null : this.clampY(this.pos.y, r.height),
      }
    },
  },
}
</script>

<style scoped>
/* 默认贴底（横向由 JS 量完实体写 left），拖动后改用 left/top 绝对定位 */
.float-win {
  position: fixed;
  left: 50%;
  bottom: 32rpx;
  max-width: calc(100vw - 40rpx);
  z-index: 26;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  /* ⚠ 根节点上不能有 transform / filter / backdrop-filter：它会把窗口变成
       内部 fixed 后代（线路库详情弹层、刷新下拉遮罩）的包含块，弹层就会被限制在窗口里 */
  background: rgba(11, 16, 32, 0.94);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 32rpx;
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.18);
  /* 量好位置前不画（否则首帧会从 left:50% 往左跳一下） */
  opacity: 0;
}
.float-win.ready {
  opacity: 1;
}
/* 拖动中：提升阴影，视觉上“拿起来了” */
.float-win.dragging {
  box-shadow: 0 32rpx 84rpx rgba(0, 0, 0, 0.62), 0 0 0 2rpx rgba(103, 232, 249, 0.35);
}
/* 已固定：标题栏不可拖，描边变紫提示“锁定中”（与车辆详情窗同一语言） */
.float-win.pinned {
  border-color: rgba(129, 140, 248, 0.55);
}
.float-win.pinned .fw-head {
  cursor: default;
}
/* 标题栏就是拖动手柄：按住任意空白处即可移动窗口 */
.fw-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 22rpx 26rpx 18rpx;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.1);
  cursor: move;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.fw-grip {
  font-size: 24rpx;
  line-height: 1;
  letter-spacing: -2rpx;
  color: rgba(255, 255, 255, 0.3);
}
.fw-title {
  font-size: 32rpx;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
}
.fw-sub {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.42);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 动作键靠右成组（sub 为空时也能顶到最右） */
.fw-actions {
  margin-left: auto;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.fw-pin,
.fw-close {
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.66);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid transparent;
  cursor: pointer;
}
.fw-pin:active,
.fw-close:active {
  transform: scale(0.92);
}
.fw-pin.on {
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.3);
  border-color: rgba(129, 140, 248, 0.65);
}
/* 内容区自己滚：标题行常驻，窗口高度由根节点的 max-height 卡住 */
.fw-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 20rpx 12rpx 24rpx;
  box-sizing: border-box;
}
</style>
