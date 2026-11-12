<template>
  <!-- 全站统一的复制胶囊：结构与刷新胶囊一致（左半执行 + 右半档位下拉）。
       左半按当前档位立即复制，右半点开三档（纯文本 / Excel / 图片）；
       档位写在全站唯一真源里，任一处切换后所有复制胶囊的标签同步跟随。 -->
  <view class="copy-pill" :class="{ 'menu-open': menu, disabled: disabled }">
    <view class="cp-main" @click="run" :title="runTitle">
      <text class="cp-ico">⧉</text>
      <text class="cp-label">{{ label }}</text>
    </view>
    <view class="cp-split"></view>
    <view class="cp-mode" @click.stop="toggle" :title="modeTitle">
      <text class="cp-mode-txt">{{ cur.short }}</text>
      <text class="cp-caret" :class="{ open: menu }">▾</text>
    </view>

    <!-- 下拉挂在胶囊正下方（CSS top:100%），方向恒为垂直向下；
         展开权由 utils/dropdown.js 统一仲裁，同屏只允许一个菜单开着 -->
    <block v-if="menu">
      <view class="cp-mask" @click.stop="closeMenu"></view>
      <view class="cp-menu" :style="menuStyle">
        <view
          class="cp-opt"
          v-for="o in OPTS"
          :key="o.key"
          :class="{ on: o.key === mode }"
          @click.stop="pick(o.key)"
        >
          <view class="cp-opt-txt">
            <text class="cp-opt-label">{{ o.label }}</text>
            <text class="cp-opt-note">{{ o.note }}</text>
          </view>
          <text class="cp-check" v-if="o.key === mode">✓</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script>
import { COPY_MODE_OPTS, getCopyMode, setCopyMode, onCopyModeChange } from '../utils/settings.js'
import { attachDropdown } from '../utils/dropdown.js'

export default {
  name: 'CopyPill',
  props: {
    // 左半文案（默认「复制」，极简面板用「线路 / 站点 / 在线」区分复制内容）
    label: { type: String, default: '复制' },
    // 无可复制内容时置灰：主键不触发，但档位仍可切换
    disabled: { type: Boolean, default: false },
  },
  data() {
    return {
      OPTS: COPY_MODE_OPTS,
      mode: getCopyMode(),
      menu: false,
      // 贴视口底部时压菜单高度（内部可滚动），位置本身交给 CSS
      menuMaxH: 0,
    }
  },
  computed: {
    cur() {
      return this.OPTS.find((o) => o.key === this.mode) || this.OPTS[0]
    },
    // 只压高度：位置由 CSS 的 top:100% / right:0 决定。
    // uni-h5 下 fixed 会被祖先降级成相对定位，用视口坐标去算反而会让菜单跑到按钮上方
    menuStyle() {
      return this.menuMaxH ? { maxHeight: this.menuMaxH + 'px' } : {}
    },
    runTitle() {
      return this.disabled ? '当前没有可复制的内容' : `按「${this.cur.label}」方式复制`
    },
    modeTitle() {
      return `复制方式：${this.cur.label}（全站共享，切换后所有复制按钮同步）`
    },
  },
  mounted() {
    // 任一处切换档位 → 本地标签跟随（订阅是全局的，跨组件、跨视图都生效）
    this._offCopyMode = onCopyModeChange((key) => { this.mode = key })
    // 展开态交给全站仲裁：别的下拉一开，本胶囊立即收起
    attachDropdown(this, 'menu', 'copy')
  },
  beforeDestroy() { this.teardown() },
  // Vue 3 命名的等价钩子：两端都写，谁生效都只清理一次
  beforeUnmount() { this.teardown() },
  methods: {
    run() {
      if (this.disabled) {
        uni.showToast({ title: '当前没有可复制的内容', icon: 'none' })
        return
      }
      this.$emit('copy', this.mode)
    },
    teardown() {
      if (this._offCopyMode) { this._offCopyMode(); this._offCopyMode = null }
      if (this._dd) { this._dd.dispose(); this._dd = null }
    },
    toggle() {
      if (this.menu) this.closeMenu()
      else this.openMenu()
    },
    openMenu() {
      if (this._dd) this._dd.open()
      this.limitMenuHeight()
    },
    closeMenu() {
      if (this._dd) this._dd.close()
    },
    // 只算高度：按钮贴底时让菜单内部滚动，顶边始终由 CSS 钉在按钮下沿
    limitMenuHeight() {
      const root = this.$el && (this.$el.$el || this.$el)
      const anchor = root && root.querySelector && root.querySelector('.cp-mode')
      if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return
      const r = anchor.getBoundingClientRect()
      const vh = window.innerHeight || 800
      this.menuMaxH = Math.max(60, Math.min(320, vh - r.bottom - 16))
    },
    pick(key) {
      this.mode = setCopyMode(key)
      this.closeMenu()
      const o = this.OPTS.find((x) => x.key === this.mode)
      uni.showToast({ title: `复制方式：${o ? o.label : this.mode}`, icon: 'none' })
    },
  },
}
</script>

<style>
/* 复制胶囊：与刷新胶囊（.refresh-pill）同高 56rpx、同圆角、同分栏结构。
   外框不裁剪（overflow 可见），圆角交给左右两半各自持有，避免挡住下拉 */
.copy-pill {
  position: relative;
  display: flex;
  align-items: stretch;
  height: 56rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  flex-shrink: 0;
  white-space: nowrap;
  transition: border-color 0.18s ease;
}
.copy-pill.menu-open {
  border-color: rgba(var(--ac-rgb), 0.5);
}
.cp-main {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 0 18rpx;
  border-radius: 999rpx 0 0 999rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.cp-main:hover {
  color: var(--ac-text);
  background: rgba(var(--ac-rgb), 0.26);
}
.cp-main:active {
  transform: scale(0.96);
}
.cp-ico {
  font-size: 22rpx;
  line-height: 1;
  opacity: 0.9;
}
.cp-split {
  width: 2rpx;
  margin: 12rpx 0;
  background: rgba(255, 255, 255, 0.16);
  flex-shrink: 0;
}
.cp-mode {
  display: flex;
  align-items: center;
  gap: 5rpx;
  padding: 0 14rpx 0 12rpx;
  border-radius: 0 999rpx 999rpx 0;
  cursor: pointer;
  transition: background 0.18s ease;
}
.cp-mode:hover {
  background: rgba(255, 255, 255, 0.1);
}
.cp-mode-txt {
  font-size: 21rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.86);
}
.cp-caret {
  font-size: 18rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.56);
  transition: transform 0.18s ease;
}
.cp-caret.open {
  transform: rotate(180deg);
}
.copy-pill.disabled {
  opacity: 0.5;
}
/* 遮罩：点空白处收起；层级高于卡片、低于菜单 */
.cp-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
}
.cp-menu {
  /* 挂在胶囊正下方：方向恒为垂直向下，不受视口坐标换算影响 */
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8rpx;
  z-index: 91;
  width: 400rpx;
  box-sizing: border-box;
  padding: 10rpx;
  /* 贴底时 max-height 会压缩菜单，内部滚动即可，顶边仍留在按钮下沿 */
  overflow-y: auto;
  border-radius: 20rpx;
  background: rgba(15, 20, 34, 0.98);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 22rpx 52rpx rgba(0, 0, 0, 0.58), inset 0 1rpx 0 rgba(255, 255, 255, 0.1);
}
.cp-opt {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  cursor: pointer;
  transition: background 0.15s ease;
}
.cp-opt:hover {
  background: rgba(255, 255, 255, 0.07);
}
.cp-opt.on {
  background: rgba(var(--ac-rgb), 0.22);
}
.cp-opt-txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.cp-opt-label {
  font-size: 23rpx;
  font-weight: 700;
  color: #fff;
}
.cp-opt-note {
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.45);
}
.cp-opt.on .cp-opt-note {
  color: rgba(255, 255, 255, 0.62);
}
.cp-check {
  font-size: 22rpx;
  font-weight: 800;
  color: var(--ac-text);
  flex-shrink: 0;
}
</style>
