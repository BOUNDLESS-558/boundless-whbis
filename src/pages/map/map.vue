<template>
  <view class="home" :class="{ 'home--map': mapMount }">
    <!-- 未选线路且不在全市态：地图没有走向可画，此时顶栏是独立玻璃卡，主视图整屏留给线路库当落地页 -->
    <view class="home-top" v-if="!mapMount">
      <LineSearch
        :views="views"
        :active-view="view"
        :meta="metaText"
        :line-no-prop="lineName || lineNo"
        @pick="onPickLine"
        @view-change="switchView"
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
            @pick="onPickLine"
            @view-change="switchView"
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

      <!-- 线路库：同样只在地图里开一扇窗，点一条直达该线路 -->
      <FloatWin
        v-else-if="hasLine && view === 'db'"
        title="线路库"
        sub="本地全量摘要 · 点一条直达"
        :width-rpx="1020"
        max-height="78vh"
        @close="view = 'map'"
      >
        <LineDb plain @pick="onPickLine" />
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
      // 全市公交激活弹窗
      actShow: false,
      actCode: '',
      lineCode: '',
      lineName: '',
      lineNo: '',
      direction: 0,
      startStop: '',
      endStop: '',
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
  },
  onLoad(query) {
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
      const code = p.lineCode || buildLineCode(p.lineName || p.lineNo || '', p.direction || 0)
      const no = String(code).split('-')[1] || p.lineName || ''
      this.lineCode = code
      this.lineNo = no
      this.lineName = p.lineName || no
      this.direction = Number(p.direction || 0)
      this.startStop = p.startStop || ''
      this.endStop = p.endStop || ''
    },
    // 顶栏搜索与线路库窗共用的选线出口
    onPickLine(p) {
      const code = p.lineCode || buildLineCode(p.lineName || p.lineNo || '', p.direction || 0)
      // 同线路重复查询：lineCode 不变时 LineMap 的 watch 不会触发，需手动强刷重发请求
      const sameLine = this.mapMount && code === this.lineCode
      this.applyPick(p)
      // 换线路一律落回地图：窗里的内容会随 lineNo 变化重拉，但用户要看的是新线走向
      this.view = 'map'
      this.writeHomeLine()
      if (sameLine) {
        const c = this.$refs.mapC
        if (c) c.loadByLine(this.lineNo, this.direction)
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
</style>
