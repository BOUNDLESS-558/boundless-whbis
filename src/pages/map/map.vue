<template>
  <view class="home" :class="{ 'home--map': hasLine }">
    <!-- 未选线路：地图没有走向可画，此时顶栏是独立玻璃卡，主视图整屏留给线路库当落地页 -->
    <view class="home-top" v-if="!hasLine">
      <LineSearch
        :views="views"
        :active-view="view"
        :meta="metaText"
        :line-no-prop="lineName || lineNo"
        @pick="onPickLine"
        @view-change="switchView"
        @open-settings="showSettings = true"
      />
    </view>

    <view class="home-stage" :class="'stage-' + (hasLine ? 'map' : view)">
      <!-- 地图是常驻底座：选了线路就整屏铺满，实时线路 / 线路库都以悬浮窗浮在它上面 -->
      <LineMap
        v-if="hasLine"
        ref="mapC"
        :line-code-prop="lineCode"
        :line-name-prop="lineName"
        :init-direction="direction"
        :embedded="true"
        :fs-enabled="false"
        @openSettings="showSettings = true"
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

      <!-- 未选线路时的整屏线路库 -->
      <view v-if="!hasLine" class="home-scroll">
        <view class="home-inner">
          <LineDb @pick="onPickLine" />
        </view>
      </view>
    </view>

    <!-- 地图服务设置（BYOK）抽屉：齿轮与地图内「设置」入口都指到这里 -->
    <SettingsDrawer :visible="showSettings" @close="showSettings = false" />
  </view>
</template>

<script>
import LineMap from '../../components/LineMap.vue'
import LineSearch from '../../components/LineSearch.vue'
import LineStops from '../../components/LineStops.vue'
import LineDb from '../../components/LineDb.vue'
import FloatWin from '../../components/FloatWin.vue'
import SettingsDrawer from '../../components/SettingsDrawer.vue'
import { buildLineCode } from '../../config.js'

// 上次查过的线路：下次进来直接落在地图上，省掉「每次都要搜一遍」
const HOME_LINE_KEY = 'whbis:home-line'
// 视图档位：地图是底座，stops / db 是浮在它上面的两扇窗
const VIEW_KEYS = ['map', 'stops', 'db']
// 没选线路时不可达的档位（无线路 = 无地图可画，也无营运信息可看）
const LINE_VIEWS = ['map', 'stops']

export default {
  name: 'HomePage',
  components: { LineMap, LineSearch, LineStops, LineDb, FloatWin, SettingsDrawer },
  data() {
    return {
      view: 'db',
      lineCode: '',
      lineName: '',
      lineNo: '',
      direction: 0,
      startStop: '',
      endStop: '',
      showSettings: false,
      // 分段三档一律用全名（悬浮窗时代，「线路 / 线路库」这种短名反而看不懂）
      views: [
        { key: 'map', label: '实时地图' },
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
    // URL 指定的档位优先（探针与外部跳转用它落在指定视图）；未选线路时只认线路库
    const v = q.view
    if (v && VIEW_KEYS.includes(v)) {
      this.view = !this.hasLine && LINE_VIEWS.includes(v) ? 'db' : v
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
      this.applyPick(p)
      // 换线路一律落回地图：窗里的内容会随 lineNo 变化重拉，但用户要看的是新线走向
      this.view = 'map'
      this.writeHomeLine()
    },
    // 分段切换：有线路时是「开窗 / 收窗」，没线路时地图与实时线路不可达
    switchView(key) {
      if (!VIEW_KEYS.includes(key)) return
      if (this.hasLine) {
        // 再点当前档 = 收回悬浮窗，回到纯地图
        this.view = key === this.view ? 'map' : key
        return
      }
      if (LINE_VIEWS.includes(key)) {
        uni.showToast({ title: '请先选择一条线路', icon: 'none' })
        return
      }
      this.view = key
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
</style>
