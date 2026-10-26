<template>
  <view class="lmap-page" :class="{ fs: isFullscreen }">
    <!-- 有地图 Key：渲染原生地图；:key 变化时整体重建，杜绝旧 callout 浮层残留 -->
    <map
      v-if="useMap"
      :key="mapKey"
      class="map"
      :latitude="mapCenter.lat"
      :longitude="mapCenter.lng"
      :markers="markers"
      :polyline="polylines"
      :scale="mapScale"
      :show-location="false"
      @markertap="onMarkerTap"
      @regionchange="onRegionChange"
    ></map>

    <!-- 无地图 Key：自绘线路走向图（Web Mercator 投影，全屏可拖动缩放，不依赖任何 Key） -->
    <!-- 手势在 mounted 里用原生监听绑定（uni-app 对 view 的 wheel/mouse 事件支持不可靠） -->
    <view v-else class="schematic" :class="{ 'has-tiles': showBaseMap }">
      <!-- 底图：高德标准瓦片（免 Key；GCJ-02 与武汉接口同源，零纠偏） -->
      <view class="tile-layer" v-if="showBaseMap">
        <image
          v-for="t in tiles"
          :key="t.key"
          class="tile"
          :src="t.url"
          :style="{ left: t.left + 'px', top: t.top + 'px', width: t.size + 'px', height: t.size + 'px' }"
        />
        <!-- 瓦片是浅色的，压一层暗色蒙版保证白字站名/车号可读 -->
        <view class="tile-shade"></view>
      </view>
      <svg class="route-svg" :viewBox="`0 0 ${canvas.w} ${canvas.h}`" preserveAspectRatio="none">
        <!-- 经纬网格（随相机平移缩放） -->
        <line
          v-for="g in gridLines"
          :key="g.key"
          :x1="g.x1"
          :y1="g.y1"
          :x2="g.x2"
          :y2="g.y2"
          stroke="rgba(148, 163, 255, 0.10)"
          stroke-width="1"
        />
        <!-- 走向线：外发光 + 主线（按方向分色，全部模式双方向同屏） -->
        <path
          v-for="r in svgRoutes"
          :key="'rg' + r.dir"
          :d="r.d"
          fill="none"
          :stroke="r.color"
          stroke-width="14"
          stroke-linecap="round"
          stroke-linejoin="round"
          opacity="0.12"
        />
        <path
          v-for="r in svgRoutes"
          :key="'r' + r.dir"
          :d="r.d"
          fill="none"
          :stroke="r.color"
          :stroke-dasharray="r.dash"
          :stroke-width="r.w"
          :opacity="r.op"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <!-- 行进方向箭头 -->
        <g v-for="(a, i) in routeArrows" :key="'a' + i" :transform="`translate(${a.x},${a.y}) rotate(${a.deg})`">
          <path d="M-3,-4.5 L4.5,0 L-3,4.5" fill="none" :stroke="a.color" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </g>
        <!-- 站点（首末站实心 + 白环，其余空心环取方向色） -->
        <g v-for="(s, i) in svgStops" :key="'s' + i">
          <circle
            :cx="s.x"
            :cy="s.y"
            :r="s.terminal ? 6 : 4"
            :fill="s.terminal ? s.color : '#0b1020'"
            :stroke="s.terminal ? '#ffffff' : s.color"
            :stroke-width="s.terminal ? 2.5 : 2"
            style="cursor: pointer"
            @click="onStopTap(s)"
          />
        </g>
        <!-- 实时车辆（单击弹出详情面板）：白环把车点从同色走向线上拉开 -->
        <g v-for="b in svgBuses" :key="b.key" style="cursor: pointer" @click="onBusTap(b.bus)">
          <!-- 定位成功后的扩散环：告诉用户“就是这个点” -->
          <circle v-if="b.located" class="bus-pulse" :cx="b.x" :cy="b.y" r="9" fill="none" :stroke="b.color" stroke-width="2.4" />
          <circle :cx="b.x" :cy="b.y" r="15" :fill="b.color" opacity="0.16" />
          <circle
            :cx="b.x"
            :cy="b.y"
            :r="b.selected ? 9 : 6.5"
            :fill="b.color"
            stroke="#ffffff"
            :stroke-width="b.selected ? 3 : 2.2"
          />
        </g>
        <!-- 全市线网走向：远景按方向色合并成两条巨路径，近景逐条；始终在车点层之下 -->
        <path
          v-for="r in cityNetPaths"
          :key="'cn' + r.key"
          :d="r.d"
          fill="none"
          :stroke="r.color"
          :stroke-width="r.w"
          :opacity="r.op"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <!-- 全市实时分布：速度分色车点 + 像素网格聚合团（仅在其它图层之上、线网之下） -->
        <g v-for="d in cityDots" :key="'ct' + d.key" style="cursor: pointer" @click="onCityDotTap(d)">
          <circle v-if="d.located" class="bus-pulse" :cx="d.x" :cy="d.y" :r="d.r" fill="none" :stroke="d.color" stroke-width="2.4" />
          <circle :cx="d.x" :cy="d.y" :r="d.r + 6" :fill="d.color" opacity="0.18" />
          <circle
            :cx="d.x"
            :cy="d.y"
            :r="d.r"
            :fill="d.color"
            stroke="#ffffff"
            :stroke-width="d.bus ? 1.8 : 2.4"
          />
        </g>
      </svg>
      <!-- 站名 / 车号文字：SVG 里的 <text> 会被 uni-app 编译成 uni-text 而无法渲染，故用 HTML 层叠加 -->
      <view class="label-layer">
        <view
          v-for="s in labelStops"
          :key="'lb' + s.dir + '-' + s.idx"
          class="stop-label"
          :class="{ left: s.anchor === 'end', terminal: s.terminal }"
          :style="{ left: s.lx + 'px', top: s.ly + 'px' }"
        >
          <text>{{ s.name }}</text>
        </view>
        <view
          v-for="b in svgBuses"
          :key="'bl' + b.key"
          class="bus-label"
          :class="b.edge ? 'edge-' + b.edge : ''"
          :style="{ left: b.x + 'px', top: b.labelY + 'px', color: b.color }"
          v-show="b.label"
        >
          <text>{{ b.label }}</text>
        </view>
        <!-- 聚合团的车辆数：SVG 里的 <text> 渲染不出来，同样走 HTML 层 -->
        <view
          v-for="c in cityCounts"
          :key="'cc' + c.key"
          class="city-count"
          :style="{ left: c.x + 'px', top: c.y + 'px' }"
        >
          <text>{{ c.n }}</text>
        </view>
        <!-- 全市近景的自编号标签（只在缩放门槛以上出现，且做过碰撞避让） -->
        <view
          v-for="t in cityTags"
          :key="'tg' + t.key"
          class="city-tag"
          :class="{ sel: t.sel }"
          :style="{ left: t.x + 'px', top: t.y + 'px', color: t.color }"
        >
          <text>{{ t.text }}</text>
        </view>
      </view>
      <!-- 空态提示（不拦截手势） -->
      <view class="canvas-empty" v-if="!cityOn && !svgStops.length && !svgBuses.length">
        <text class="empty-big">🚌</text>
        <text class="empty-txt">{{ lineNo ? '正在加载线路走向…' : '输入线路号查询，即可绘制走向与在运车辆' }}</text>
      </view>
      <view class="canvas-empty" v-else-if="cityOn && !cityBusy && !cityDots.length">
        <text class="empty-big">🌐</text>
        <text class="empty-txt">{{ cityFilterNo ? '筛选「' + cityFilterNo + '」没有匹配的车辆' : '快照里没有车辆（可能已收班，点 ↻ 重扫试试）' }}</text>
      </view>
      <!-- 图例（线路态：上下行走向；全市态换成下面的车速 + 线网图例） -->
      <view class="schematic-legend" v-if="!cityOn">
        <text class="legend-item"><text class="ln up"></text>上行走向</text>
        <text class="legend-item"><text class="ln down"></text>下行走向</text>
        <text class="legend-item"><text class="dot stop"></text>站点 / 车辆</text>
      </view>
    </view>

    <!-- 鼠标悬停车辆图标的浮标：只显示自编号数字本身，鼠标离开即消失（不常驻遮挡）；
         触屏无 hover，单击车图标直接看详情浮窗 -->
    <view class="bus-hover" v-if="hoverTip" :style="{ left: hoverTip.x + 'px', top: hoverTip.y + 'px' }">
      <text class="bh-no">{{ hoverTip.no || '…' }}</text>
      <text class="bh-line" v-if="hoverTip.line">{{ hoverTip.line }}</text>
    </view>

    <!-- 左上角控制卡：搜索 / 主操作 / 视图工具 / 方向与线路，全部收进一张玻璃卡片，
         区内用细分割线断开 —— 之前四个独立胶囊各自带阴影，浮在地图上分不出层级 -->
    <view class="ctrl">
      <!-- ◎ 宿主注入的首块（首页地图视图：视图分段 + 线路搜索联想）。
         顶栏卡不再浮在地图外面，而是并入这张控制卡，与方向行 / 视图工具行共用一个卡壳 -->
      <slot name="top"></slot>
      <view class="ctrl-div" v-if="hasTopSlot"></view>

      <!-- ① 搜索行（仅独立页渲染；嵌入态线路由宿主页给定） -->
      <view class="ctrl-search" v-if="!embedded">
        <view class="ctrl-back" @click="goBack" title="返回">‹</view>
        <text class="ctrl-icon">🔍</text>
        <input
          class="ctrl-input"
          v-model="searchNo"
          type="text"
          placeholder="输入线路号，如 337 / 电1"
          placeholder-class="ctrl-ph"
          confirm-type="search"
          @confirm="doSearchMap"
        />
        <view class="ctrl-go" @click="doSearchMap">查询</view>
      </view>

      <view class="ctrl-div" v-if="!embedded"></view>

      <!-- ② 方向与线路：直接选方向 + 当前线路号 + 营运公司徽标（必须单行）
           实时车辆挂载即自动加载，刷新统一走车辆面板的 ↻/间隔下拉，不再放「一键查询」按钮。
           全市公交视图下整行隐藏：上下行属于「当前这一条线」，与全市线网不是一个作用域 -->
      <view class="ctrl-dir" v-if="!cityOn">
        <view class="dir-tab" :class="{ active: dirFilter === 2 }" @click="setDirView(2)">全部</view>
        <view class="dir-tab up" :class="{ active: dirFilter === 0 }" @click="setDirView(0)">上行</view>
        <view class="dir-tab down" :class="{ active: dirFilter === 1 }" @click="setDirView(1)">下行</view>
        <!-- 循环切换视角（全部→上行→下行）的小方键：紧贴在三个 tab 右侧，颜色随当前视角变化 -->
        <view class="dir-swap" :class="'d' + dirFilter" @click="cycleDirView" :title="'切换到下一个视角（当前：' + dirFilterLabel + '）'">⇄</view>
        <!-- 线路号徽章：胶囊描边 + 大号数字 + 小字「路」，与右侧公司徽标同一视觉语言 -->
        <view class="dir-cur" v-if="lineName" :title="'当前线路：' + lineName + ' 路'">
          <text class="dc-no">{{ lineName }}</text>
          <text class="dc-unit">路</text>
        </view>
        <view class="dir-cur none" v-else>未选择线路</view>
        <!-- 所属营运公司（由在线车辆自编号首位推断）：紧跟在“337 路”后面同一行，不换行 -->
        <view class="ctrl-org" v-if="operatorCompanies.length">
          <view class="org-tag" v-for="c in operatorCompanies" :key="c.no" :title="c.label">
            <text class="org-no">{{ c.no }}</text>
            <text class="org-name">{{ c.short }}</text>
          </view>
        </view>
      </view>

      <!-- ④ 视图工具：缩放 / 全览 / 站名 两种模式通用（原生地图下分别调 scale、自适应、切 marker 站名）；
           「底图」只切自绘模式的高德瓦片层，原生 <map> 底图无法隐藏，故仅自绘模式显示 -->
      <view class="ctrl-div"></view>
      <view class="ctrl-view">
        <view class="tool-btn sq" @click="zoomBy(0.6)" title="放大">＋</view>
        <view class="tool-btn sq" @click="zoomBy(-0.6)" title="缩小">－</view>
        <view class="tool-btn sm" @click="resetView" :title="cityOn ? '全览全市在运车辆' : '全览整条线路'">⤢ 全览</view>
        <view class="tool-btn sm" :class="{ on: showStopLabels }" @click="toggleLabels">站名</view>
        <view class="tool-btn sm" v-if="!useMap" :class="{ on: showBaseMap }" @click="toggleBaseMap">底图</view>
      </view>
      <view class="view-alert" v-if="routeAlert && !cityOn">{{ routeAlert }}</view>

      <!-- 全市公交区：指标区（数字重 / 标签轻）+ 查线路 + 查车 + 拉取操作。
           只在全市视图出现，不跟线路态的视图工具行抢位置；卡片加高是安全的（fitRect 读实测 bottom） -->
      <block v-if="cityOn">
        <view class="ctrl-div"></view>
        <view class="ctrl-city">
          <view class="cc-figs">
            <view class="cc-fig">
              <text class="f-num">{{ cityFig.count }}</text>
              <text class="f-lab">辆在运</text>
            </view>
            <view class="cc-fig">
              <text class="f-num">{{ cityFig.lines }}</text>
              <text class="f-lab">条线路</text>
            </view>
            <view class="cc-fig">
              <text class="f-num">{{ cityFig.main }}</text>
              <text class="f-sub" v-if="cityFig.sub">{{ cityFig.sub }}</text>
              <text class="f-lab">{{ cityFig.lab }}</text>
            </view>
            <!-- 已筛选某条线：不再占掉一个整按钮位，挂在指标末尾一枚小徽标上 -->
            <view class="cc-chip" v-if="cityFilterNo" :title="'只看 ' + cityFilterNo + ' 路，点 ✕ 看回全市'">
              <text class="chip-txt">已筛选 {{ cityFilterNo }}</text>
              <text class="chip-x" @click="clearCityQuery">✕</text>
            </view>
          </view>
          <view class="cc-meta">
            <text class="cm-item">{{ cityStampText }} · {{ cityNetNote }}</text>
          </view>
          <text class="cc-warn" v-if="cityWarnText">⚠ {{ cityWarnText }}</text>
          <view class="cc-bar" v-if="cityBusy"><view class="cc-bar-in" :style="{ width: cityProgress + '%' }"></view></view>
        </view>
        <view class="ctrl-city-row">
          <input class="cc-input" v-model="cityQueryNo" type="text" placeholder="线路号，如 578 / 电1" placeholder-class="cc-ph" confirm-type="search" @confirm="cityQueryLine" />
          <view class="cc-btn" @click="cityQueryLine">查线路</view>
        </view>
        <view class="ctrl-city-row">
          <input class="cc-input" v-model="cityFindNo" type="text" placeholder="自编号，如 3240" placeholder-class="cc-ph" confirm-type="search" @confirm="cityFind" />
          <view class="cc-btn" @click="cityFind">查车</view>
          <view class="cc-btn ghost" :class="{ on: cityShowOrgId }" title="近景给每辆车标出自编号" @click="toggleCityTags">自编号</view>
        </view>
        <view class="ctrl-city-row">
          <view class="cc-btn ghost" v-if="!cityBusy" :title="'重新拉取全网（约 ' + cityCost + ' 个请求）'" @click="runCity(true)">↻ 重扫</view>
          <view class="cc-btn ghost" v-else title="中止本轮拉取（保留已扫到的部分结果）" @click="cancelCity">✕ 中止</view>
          <view class="cc-btn ghost" :class="{ on: cityFollow > 0 }" :title="cityFollowTitle" @click="cycleCityFollow">{{ cityFollowLabel }}</view>
        </view>
      </block>
    </view>

    <!-- 全市图例：线网走向 + 车速分档，两种渲染模式共用，贴左下角（线路态的走向图例此时已隐藏） -->
    <view class="city-legend" v-if="cityOn">
      <text class="cl-head">全市线网 / 车速 km/h</text>
      <text class="cl-item"><text class="cl-line up"></text>上行走向</text>
      <text class="cl-item"><text class="cl-line down"></text>下行走向</text>
      <text class="cl-item" v-for="(bnd, i) in cityBands" :key="'cb' + i">
        <text class="cl-dot" :style="{ background: bnd.color }"></text>{{ bnd.label }}
      </text>
      <text class="cl-tip">点车点看详情 · 点数字团放大</text>
    </view>

    <!-- 右侧栏：实时车辆面板在上，发车时刻表面板独立挂在它下方（两张卡各自成块，不共用一个面板壳）。
         全市态整栏隐藏：这里的内容属于「当前这一条线」，与全市分布不是一个作用域，且要把画面让给车点 -->
    <view class="side-col" v-if="!cityOn">
      <!-- 实时车辆面板（可折叠，列表随视角方向过滤） -->
      <view class="panel" :class="{ collapsed: panelCollapsed }">
        <view class="panel-header">
          <view class="panel-title">实时车辆（{{ shownBuses.length }}辆 · {{ dirFilterLabel }}）</view>
          <view class="collapse-btn" :class="{ folded: panelCollapsed }" @click="panelCollapsed = !panelCollapsed" :title="panelCollapsed ? '展开' : '折叠'">▾</view>
        </view>
        <!-- 刷新行：左半 ↻ 立即拉一次；右半显示当前间隔，单击展开 手动 / 15秒 / 20秒 / 30秒 -->
        <view class="panel-tools">
          <view class="refresh-wrap">
            <view class="refresh-pill" :class="{ busy: loading, auto: refreshSec > 0 }">
              <view class="rp-refresh" @click="refreshNow" :title="loading ? '刷新中…' : '立即刷新'">
                <text class="rp-ico" :class="{ spin: loading }">↻</text>
              </view>
              <view class="rp-split"></view>
              <view class="rp-mode" @click="refreshMenu = !refreshMenu" :title="refreshTitle">
                <text class="rp-txt">{{ refreshLabel }}</text>
                <text class="rp-caret" :class="{ open: refreshMenu }">▾</text>
              </view>
            </view>
            <view class="refresh-menu" v-if="refreshMenu">
              <view
                class="rm-item"
                v-for="opt in refreshOptions"
                :key="opt.sec"
                :class="{ on: refreshSec === opt.sec }"
                @click="setRefreshSec(opt.sec)"
              >
                <text class="rm-label">{{ opt.label }}</text>
                <text class="rm-tip">{{ opt.tip }}</text>
                <text class="rm-check" v-if="refreshSec === opt.sec">✓</text>
              </view>
            </view>
          </view>
          <text class="pt-hint">{{ refreshSec > 0 ? '自动刷新中' : '仅点 ↻ 时拉取' }}</text>
        </view>
        <view class="panel-body" v-show="!panelCollapsed">
          <!-- 普通 view + overflow-y 自己滚：不用 <scroll-view>，它在 flex 限高下内层会涨到内容高（宿主 overflow 可视），车一多就画到卡外面 -->
          <view class="bus-list" v-if="shownBuses.length">
            <view class="bus-item" v-for="(bus, i) in shownBuses" :key="bus.dir + '-' + i" @click="selectBus(bus)">
              <view class="bus-left">
                <!-- ★ 自编号（由 MD5 加密值还原，如 3240）+ 方向徽标 -->
                <view class="bus-org">
                  {{ bus.orgId || '未知' }}
                  <text class="bus-dir" :class="'d' + bus.dir">{{ bus.dir === 0 ? '上行' : '下行' }}</text>
                </view>
                <view class="bus-hash">{{ bus.busNo }}</view>
              </view>
              <view class="bus-right">
                <view class="bus-speed">⚡ {{ bus.gpsSpeed }} km/h</view>
                <view class="bus-time">🕐 {{ bus.time }}</view>
              </view>
            </view>
          </view>
          <view class="empty" v-else>当前{{ dirFilterLabel === '全部' ? '' : dirFilterLabel }}没有在线车辆</view>
        </view>
      </view>

      <!-- 发车时刻表面板（原独立整屏视图移到这里）：上行与下行同屏各一组，不随控制卡视角二选一；
           自带折叠键（与车辆面板同一枚圆键），两张卡各自成块、各折各的 -->
      <view class="plan-side" v-if="lineNo">
        <LinePlan :line-no="lineNo" />
      </view>
    </view>

    <!-- 刷新间隔下拉的“点外部关闭”透明遮罩：面板带 backdrop-filter 会形成包含块，遮罩只能放在面板外 -->
    <view class="rm-mask" v-if="refreshMenu" @click="refreshMenu = false"></view>

    <!-- 车辆详情窗：单击地图标记 / 示意图车辆 / 右侧列表项弹出。可拖动、可固定位置、可关闭；
         不带全屏遮罩 —— 窗口开着时地图仍可拖拽缩放，不遮挡操作 -->
    <view class="bus-sheet" v-if="selectedBus" :class="{ pinned: sheetPinned, dragging: sheetDragging }" :style="sheetStyle">
      <view
        class="sheet-head"
        :title="sheetPinned ? '已固定，点 📌 解锁后可拖动' : '按住标题栏拖动窗口'"
        @touchstart.stop="sheetDown"
        @touchmove.stop.prevent="sheetMove"
        @touchend.stop="sheetUp"
        @touchcancel.stop="sheetUp"
      >
        <view class="sheet-title">
          <text class="sheet-grip">⣿</text>
          <text class="sheet-line">{{ sheetTitle }}</text>
          <text class="sheet-dir" :class="'d' + selectedBus.dir">{{ selectedBus.dir === 0 ? '上行' : '下行' }}</text>
        </view>
        <view class="sheet-actions">
          <view
            class="sheet-pin"
            :class="{ on: sheetPinned }"
            @click.stop="toggleSheetPin"
            :title="sheetPinned ? '取消固定（恢复拖动）' : '固定位置（锁定拖动）'"
          >📌</view>
          <view class="sheet-close" @click.stop="closeSheet" title="关闭">✕</view>
        </view>
      </view>
      <view class="sheet-row" v-if="cityOn"><text class="sk">所属线路</text><text class="sv">{{ selectedBus.no }} 路 · {{ selectedBus.dir === 0 ? '上行' : '下行' }}</text></view>
      <view class="sheet-row"><text class="sk">所属营运公司</text><text class="sv">{{ busCompanyText(selectedBus) }}</text></view>
      <view class="sheet-row"><text class="sk">自编号</text><text class="sv">{{ selectedBus.orgId || '未知（编号字典还原中…）' }}</text></view>
      <view class="sheet-row"><text class="sk">车速</text><text class="sv">{{ selectedBus.gpsSpeed }} km/h</text></view>
      <view class="sheet-row"><text class="sk">运行状态</text><text class="sv">{{ busStateText(selectedBus) }}</text></view>
      <view class="sheet-row"><text class="sk">GPS 时间</text><text class="sv">{{ selectedBus.time }}</text></view>
      <view class="sheet-row"><text class="sk">经纬度（GCJ-02）</text><text class="sv">{{ selectedBus.lng }}, {{ selectedBus.lat }}</text></view>
      <view class="sheet-btns">
        <view class="sheet-btn" @click="focusBus(selectedBus)" title="居中并把地图放到最大，精确查看这辆车">📍 在地图上定位</view>
        <!-- 全市态下的出口：从一辆车跳到它所属的线路（看得到走向、站点与同线其他车） -->
        <view class="sheet-btn go" v-if="cityOn && selectedBus.code" @click="openCityLine(selectedBus)" :title="'切换到 ' + selectedBus.no + ' 路地图'">🗺 打开 {{ selectedBus.no }} 路</view>
      </view>
    </view>

    <!-- 全屏切换（仅嵌入态）：把整块地图从 72vh 宿主里提出来铺满视口；再点一次或按 ESC 退出 -->
    <view class="fs-btn" v-if="embedded && fsEnabled" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏（ESC）' : '全屏查看'">
      <text class="fs-ico">{{ isFullscreen ? '⤡' : '⛶' }}</text>
      <text class="fs-txt">{{ isFullscreen ? '退出全屏' : '全屏' }}</text>
    </view>
  </view>
</template>

<script>
import { fetchRealTime, fetchLine, decryptBusId, onBusIdReady } from '../utils/api.js'
import { fetchRoadRoute } from '../utils/osrm.js'
import { APP_CONFIG, buildLineCode, useNativeMap } from '../config.js'
import { assetUrl } from '../utils/asset.js'
import {
  citySweepCost, sweepCity, loadSnapshot, loadLastSnapshot, snapshotAge,
  findBusByOrgId, refreshOrgIds, clusterPoints, SPEED_BANDS, CITY_FRESH_MS,
  cityWarned, markCityWarned, loadCityNet, netSearchLines, bboxIntersects,
} from '../utils/cityBus.js'
import LinePlan from './LinePlan.vue'

// —— 方向配色（全站统一）：上行 = 青蓝，下行 = 玫红 ——
// 色相相隔约 150°，在浅色高德底图与深色自绘画布上都清晰；不依赖红绿对比，色盲用户也能分辨。
// casing/inner 用于原生地图的双层折线（白色外描边 + 方向色主线，路线高亮质感），
// svgStroke 用于自绘走向图，bus 为车辆圆点与车号（同色系提亮，靠白色描边与主线拉开层次）。
// labelText 是站名文字色：取同色系压暗两档，浅色底图上比主线更易读，又仍属于该方向色。
// ⚠ 详情页 line.vue 的线路带、方向徽标必须沿用同一套色，否则两个页面对「上下行」的颜色理解会打架。
const DIR_STYLE = {
  0: { name: '上行', casing: '#FFFFFF', inner: '#06B6D4', svgStroke: '#22D3EE', bus: '#67E8F9', labelText: '#0E7490' },
  1: { name: '下行', casing: '#FFFFFF', inner: '#F43F5E', svgStroke: '#FB7185', bus: '#FDA4AF', labelText: '#BE185D' },
}
// 刷新间隔选项（秒）：0 = 手动刷新，其余为自动刷新周期。选择结果持久化，下次进地图页沿用。
const REFRESH_OPTS = [0, 15, 20, 30]
const REFRESH_KEY = 'whbis:map-refresh-sec'
// —— 全市实时分布 ——
// 自动跟随档位（分钟）：0 = 手动。一轮扫描 ≈ 1535 个请求（生产环境全部走 Worker 反代），
// 所以不给 15/30 秒这种线路态档位，最低 5 分钟且默认关闭，配额代价写在按钮提示里。
const CITY_FOLLOW_OPTS = [0, 5, 15, 30]
const CITY_FOLLOW_KEY = 'whbis:city-follow-sec'
// 聚合网格边长（px）：原生 marker 是 DOM 节点，成本高→网格稀一点；自绘走 SVG，可以密一点
const CITY_CELL_NATIVE = 52
const CITY_CELL_SVG = 34
// 放大到该级别以上就不再聚合（视野里本来没几辆车，聚合反而遮住个体）
const CITY_CLUSTER_MIN_ZOOM = 15
// 原生 marker id 分段：站点 5000~6999、本线车辆 20000/30000 段，全市车点用 5 万/6 万段避开
const CITY_DOT_ID = 50000
const CITY_CLUSTER_ID = 60000
// —— 全市线网底图的绘制预算 ——
// 远景（整个武汉市）1187 个方向逐条画会生成 1100+ 个 <path>，每次拖帧都要重建一遍 vnode；
// 低于该缩放时按方向色合并成两条巨型 path（全市尺度下网络靠密度表达，单条颜色本来也看不清）
const CITY_NET_FUSE_ZOOM = 12.6
// 近景逐条绘制时的方向数上限（视口裁剪后本就剩不了几条，再多彩虹也会糊成一团）
const CITY_NET_MAX_PATHS = 260
// 单次渲染的投影点预算：超了就按整条线等距抽稀（远景本就看不出弯折）
const CITY_NET_MAX_PTS = 16000
// 原生 <map> 的折线条数上限：uni-h5 每条折线都是独立覆盖物，200 条已明显吃力
const CITY_NET_MAX_NATIVE = 180
// 自编号标签门槛：全市 1300 辆车全标会糊屏，缩放到近景才标且有数量上限
const CITY_TAG_MIN_ZOOM = 13.4
const CITY_TAG_MIN_SCALE = 15.4
const CITY_TAG_MAX = 120
const CN_ORG = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']
// 营运公司：由自编号首位推断（1 → 武汉公交集团第一公司）
function orgCompanyOf(b) {
  const d = String(b.orgId || '').charAt(0)
  return d >= '1' && d <= '9' ? `武汉公交集团${CN_ORG[Number(d)]}公司` : '未知公司'
}
// 行驶状态：到站 / 行驶 / 停靠
function busStateOf(b) {
  return b.arrived === '1' ? '到站' : (parseFloat(b.gpsSpeed) > 0 ? '行驶' : '停靠')
}

// —— 自绘走向图的 Web Mercator 投影工具 ——
// 经纬度 → 单位平面坐标（u/v 均在 0~1），屏幕像素 = (u - cam.u) * 256 * 2^zoom + 屏幕偏移
const mercX = (lng) => (lng + 180) / 360
const mercY = (lat) => {
  const r = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}
const zoomScale = (z) => 256 * Math.pow(2, z)
// Mercator 逆投影：定位时要把“希望车出现的屏幕点”反算成地图中心
const invMercX = (u) => u * 360 - 180
const invMercY = (v) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI
const clampNum = (v, min, max) => Math.min(max, Math.max(min, v))
// 估算文本像素宽度（font-size 11px：汉字约 11px、数字/拉丁约 7px），用于标签避让碰撞判定
function textW(s) {
  let w = 0
  for (const ch of String(s || '')) w += ch.charCodeAt(0) > 255 ? 11 : 7
  return w
}
// 沿「行驶方向右侧」把整条轨迹平移若干米：上下行同屏时分居道路两侧。
// 不偏移时两条线在多数街道上几乎完全重合，后绘制的一方会把先绘制的整条盖掉，等于看不见下行。
// 经纬度按局部平面近似换算（武汉纬度 30.5°，1° 纬度 ≈ 110.5km、1° 经度 ≈ 95.5km），误差可忽略。
function offsetPolyline(points, meters) {
  if (!meters || points.length < 2) return points
  const ky = 110540
  const kx = 111320 * Math.max(0.2, Math.cos((points[0].latitude * Math.PI) / 180))
  const n = points.length
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(n - 1, i + 1)]
    const ex = (b.longitude - a.longitude) * kx // 前进方向东分量（米）
    const ey = (b.latitude - a.latitude) * ky   // 前进方向北分量（米）
    const len = Math.hypot(ex, ey) || 1
    // 右手法向量（东, 北）=（hy, -hx）
    return {
      latitude: p.latitude - ((ex / len) * meters) / ky,
      longitude: p.longitude + ((ey / len) * meters) / kx,
    }
  })
}
// 平滑路径：用相邻点中点做二次贝塞尔，避免站点直连的折角
function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mxp = (pts[i].x + pts[i + 1].x) / 2
    const myp = (pts[i].y + pts[i + 1].y) / 2
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mxp.toFixed(1)} ${myp.toFixed(1)}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`
  return d
}

export default {
  components: { LinePlan },
  props: {
    lineCodeProp: { type: String, default: '' },
    initDirection: { type: Number, default: 0 },
    lineNameProp: { type: String, default: '' },
    embedded: { type: Boolean, default: false },
    // 宿主已把地图铺满整屏时不再需要「全屏查看」键（首页地图视图即如此）
    fsEnabled: { type: Boolean, default: true },
    // 全市公交视图由宿主顶部分段驱动（判据只留在宿主一处，组件不再自带开关）
    cityMode: { type: Boolean, default: false },
  },
  data() {
    return {
      lineCode: '',
      // 线路号（lineCode 的第二段，双方向编码共用）
      lineNo: '',
      direction: 0,
      lineName: '',
      // 搜索框输入的线路号
      searchNo: '',
      // 车辆视角方向：0 上行 / 1 下行 / 2 全部（默认双方向同屏）
      dirFilter: 2,
      // 双方向数据缓存：站点 / 道路吸附轨迹 / 实时车辆
      stopsByDir: { 0: [], 1: [] },
      routeByDir: { 0: [], 1: [] },
      // 走向贴路状态：idle 未开始 / loading 计算中 / ok 已贴路 / fail 失败（当前为站间直连）
      routeState: { 0: 'idle', 1: 'idle' },
      busesByDir: { 0: [], 1: [] },
      // 当前选中查看详情的车辆（null=不显示详情窗）
      selectedBus: null,
      // 详情窗：拖动后的像素位置（null = 用 CSS 默认位置）/ 是否已固定（锁定拖动）/ 是否正在拖动
      sheetPos: null,
      sheetPinned: false,
      sheetDragging: false,
      loading: false,
      // 地图重建键：uni-app H5 的 callout 浮层在标记更新/清空时会泄漏残留，每次刷新后 +1 强制重建地图
      mapKey: 0,
      // 右侧面板折叠状态
      panelCollapsed: false,
      // 刷新间隔（秒）：0 = 手动刷新；15 / 20 / 30 = 自动刷新
      refreshSec: 0,
      // 刷新间隔下拉是否展开
      refreshMenu: false,
      // 原生地图缩放级别（regionchange 时同步，重建地图后保持用户视角）
      mapScale: 13,
      mapCenter: { lat: 30.5, lng: 114.2 },
      // 自绘走向图：画布尺寸(px) / 相机(Web Mercator 单位坐标 u,v + 缩放) / 相机中心屏幕位置
      canvas: { w: 375, h: 667 },
      cam: { u: 0.5, v: 0.4, zoom: 13 },
      projCenter: { x: 187, y: 333 },
      // UI 占位（控制卡 / 右侧面板 / 图例），用于计算路线可绘制区域
      uiRects: { ctrl: null, side: null, legend: null },
      // 相机是否已按线路自适应过一次（避免 15s 刷新时视图乱跳）
      camInited: false,
      showStopLabels: true,
      // 标准地图底图（高德瓦片，免 Key）：开关 + 当前视口的瓦片列表
      showBaseMap: true,
      tiles: [],
      svgStops: [],
      svgBuses: [],
      svgRoutes: [],
      routeArrows: [],
      gridLines: [],
      // 站名标签（HTML 层渲染，带避让后仅保留不重叠的）
      labelStops: [],
      // 鼠标悬停车辆图标的浮标（{ x, y, no }：x/y 为相对 .page 的像素位）
      hoverTip: null,
      // 嵌入态全屏开关：true 时根节点挂 .fs（fixed 铺满视口）
      isFullscreen: false,
      // 刚定位过的车辆：在自绘图上画一圈扩散波，告诉用户“就是这一个点”
      locatedBus: null,
      // 全市快照内容被就地改写过的计数（refreshOrgIds 不走响应式 setter，靠它推 marker 重算）
      cityDirty: 0,
      // —— 全市实时分布（快照 = 分布图数据源 + 自编号反查索引）——
      cityOn: false,
      // 扫描进行中（按钮上显百分比，并换成「取消」）
      cityBusy: false,
      cityProgress: 0,
      // 扫描进行中的实时计数（仅用于统计行文案）
      cityFound: 0,
      // 快照里的车辆（已按 busId 去重）
      cityBuses: [],
      // 本轮扫描元信息：{ at, ms, total, done, failed, lines, count, partial }
      cityMeta: null,
      // 按线路号筛选（缩小到某条线的车，不重新请求）
      cityFilterNo: '',
      // 自编号查车输入框
      cityFindNo: '',
      // 自动跟随间隔（分钟，0=手动）
      cityFollow: 0,
      // 自绘模式下的全市圆点/聚合团（屏幕坐标，由 renderSchematic 算出）
      cityDots: [],
      // 全市线网走向路径（自绘模式）：[{ key, d, color, w, op }]
      cityNetPaths: [],
      // 全市自编号标签（自绘模式，走 HTML 标签层）：[{ key, x, y, text, color, sel }]
      cityTags: [],
      // 线网统计（只放文案要用的字段；几何本体挂 this._net，5w 个数字进 data 会拖慢每帧）
      cityNetStat: null,
      cityNetBusy: false,
      // 线网就绪计数：_net 非响应式，靠它推原生折线重算
      cityNetTick: 0,
      // 线路号查询输入（点「查线路」才落到 cityFilterNo，避免边打字边重排千条走向）
      cityQueryNo: '',
      // 线路号查询命中线网时的条目（统计行要显示它的方向数/站数）
      cityHitLine: null,
      // 近景是否给单车标自编号
      cityShowOrgId: true,
      // 原生视野变更计数：_view 是普通属性（非响应式），全市聚合要靠它触发重算
      viewTick: 0,
    }
  },
  computed: {
    // 宿主是否注入了 top 插槽
    hasTopSlot() {
      return !!this.$slots.top
    },
    // 渲染方式由「地图服务设置」决定：选“走向图”时即使填了 Key 也用自绘；
    // 未设置时按有无 Key 自动选择（保持旧行为）
    useMap() {
      return useNativeMap()
    },
    // 当前视角方向下的车辆列表（元素含 dir 字段 0/1）
    shownBuses() {
      const all = [...this.busesByDir[0], ...this.busesByDir[1]]
      return this.dirFilter === 2 ? all : all.filter((b) => b.dir === this.dirFilter)
    },
    dirFilterLabel() {
      return this.dirFilter === 2 ? '全部' : DIR_STYLE[this.dirFilter].name
    },
    // 刷新间隔按钮上的文字：手动 / 15秒 / 20秒 / 30秒
    refreshLabel() {
      return this.refreshSec > 0 ? `${this.refreshSec}秒` : '手动'
    },
    refreshTitle() {
      return this.refreshSec > 0 ? `每 ${this.refreshSec} 秒自动刷新` : '手动刷新（点 ↻ 拉取）'
    },
    refreshOptions() {
      return [
        { sec: 0, label: '手动刷新', tip: '点 ↻ 才拉取' },
        { sec: 15, label: '15 秒', tip: '最灵敏' },
        { sec: 20, label: '20 秒', tip: '较灵敏' },
        { sec: 30, label: '30 秒', tip: '省流量' },
      ]
    },
    // 走向尚未贴路时的提示（初屏/服务故障时画的是站间直连，必须说明白）
    routeAlert() {
      const s = this.routeState
      if (s[0] === 'loading' || s[1] === 'loading') return '走向贴路计算中…（当前为站间直连，稍后自动替换）'
      const failed = ['fail'].includes(s[0]) && ['fail'].includes(s[1])
      if (failed) return '贴路服务暂不可用，当前为站间直连；可点“刷新”重试'
      return ''
    },
    // 详情窗标题：全市态显示这辆车自己的线路，线路态显示当前线路
    sheetTitle() {
      if (this.cityOn) return (this.selectedBus && this.selectedBus.no) || ''
      return this.lineName
    },
    // —— 全市实时分布 ——
    // 快照里经线路筛选后的车辆（纯本地过滤，不发请求）
    cityShown() {
      if (!this.cityOn) return []
      const q = String(this.cityFilterNo || '').trim()
      if (!q) return this.cityBuses
      return this.cityBuses.filter((b) => String(b.no).includes(q) || String(b.lineName || '').includes(q))
    },
    // 聚合团的车辆数标签：SVG 里的 <text> 渲染不出来，单独走 HTML 标签层
    cityCounts() {
      return this.cityDots.filter((d) => !d.bus)
    },
    cityBands() {
      return SPEED_BANDS
    },
    // 一轮扫描要发多少个请求（按钮提示里写清楚代价）
    cityCost() {
      return citySweepCost()
    },
    // 统计区的三个指标格：把一句话拆成「数字 + 标签」，扫描中把方向格换成实时进度
    cityFig() {
      const m = this.cityMeta
      if (this.cityBusy) {
        return { count: this.cityFound, lines: m ? m.lines : '—', main: this.cityProgress + '%', sub: '', lab: '扫描进度' }
      }
      if (!m) return { count: '—', lines: '—', main: '—', sub: '', lab: '个方向' }
      return { count: m.count, lines: m.lines, main: m.done, sub: '/ ' + m.total, lab: '个方向' }
    },
    // 时间戳只留“什么时候”，耗时是开发指标（已写在完成 toast 里），不占用户一行
    cityStampText() {
      const m = this.cityMeta
      if (!m) return '尚未拉取'
      const at = new Date(m.at)
      const hh = (n) => String(n).padStart(2, '0')
      return `${hh(at.getHours())}:${hh(at.getMinutes())}:${hh(at.getSeconds())} 更新`
    },
    // 需要用户动手的异常单独成行（琥珀色），不再混在统计里被当成普通数字扫过去
    cityWarnText() {
      const m = this.cityMeta
      if (!m) return '点「↻ 重扫」拉取全网在运车辆'
      const bits = []
      if (m.partial) bits.push(`本轮已中止，${m.failed || 0} 个方向未完成`)
      const age = Math.round(snapshotAge(m) / 60000)
      if (age >= 5) bits.push(`快照已过 ${age} 分钟，位置仅供参考`)
      return bits.join(' · ')
    },
    cityFollowLabel() {
      return this.cityFollow ? `自动跟随 ${this.cityFollow}分` : '自动跟随 关'
    },
    cityFollowTitle() {
      if (!this.cityFollow) return '自动跟随：关（每次手动重扫）'
      return `每 ${this.cityFollow} 分钟重扫一次全网：约 ${Math.round((this.cityCost * 24 * 60) / this.cityFollow / 1000)}k 次请求/天，慎用`
    },
    // 线网底图的状态文案（原生模式下要明说「视野内只绘这么多条」，否则用户会以为全市只这些线）
    cityNetNote() {
      if (this.cityNetBusy) return '线网底图加载中…'
      const st = this.cityNetStat
      if (!st) return '线网底图缺失（跑 npm run scan:net 生成）'
      if (this.cityFilterNo && this.cityHitLine) {
        const d = this.cityHitLine.dirs.length
        return `${this.cityHitLine.no} · ${d} 方向 · 最多 ${this.cityHitLine.stops} 站`
      }
      if (this.cityFilterNo) return `筛选「${this.cityFilterNo}」· 无走向数据`
      if (this.useMap) return `线网 ${st.count} 条（视野内最多绘 ${CITY_NET_MAX_NATIVE} 条）`
      return `线网 ${st.count} 条 · ${st.dirCount} 方向 · ${st.stopCount} 站`
    },
    // 地图标记：站点（圆点 + 站名常显）+ 车辆（七行信息卡分色）；用 computed 以便自编号字典就绪后自动刷新
    markers() {
      // 全市态：整张地图只放车点（裁剪 + 聚合后），站点与本线车辆全部让位
      if (this.cityOn) return this.cityNativeMarkers()
      const dirs = this.dirFilter === 2 ? [0, 1] : [this.dirFilter]
      const STOP_ID = 5000
      const stopMarkers = []
      dirs.forEach((dir) => {
        const st = DIR_STYLE[dir]
        const total = (this.stopsByDir[dir] || []).length
        ;(this.stopsByDir[dir] || []).forEach((s, i) => {
          // API 坐标已是 GCJ-02，直接使用，切勿再转（否则整体偏移数百米）
          const lat = parseFloat(s.latitude)
          const lng = parseFloat(s.longitude)
          if (isNaN(lat) || isNaN(lng)) return
          // 首末站用实心大圆突出终点，中间站用白心圆环：密集路段不再糊成一条深色带
          const isEnd = i === 0 || i === total - 1
          const stopMarker = {
            id: STOP_ID + dir * 1000 + i,
            latitude: lat,
            longitude: lng,
            // 不传 title：uni-h5 会把 title 当成 callout 内容，虽然默认隐藏，
            // 但 MapMarker 的 click 监听会 callout.visible = !visible —— 点一下就冒出一个白框盖住站名。站名已由 label 渲染。
            iconPath: assetUrl(isEnd ? `/static/stop-end-${dir}.png` : `/static/stop-dot-${dir}.png`),
            // 11px 在整线视野（scale ~13）下几乎看不见，提到 13px；首末站 19px 保持明显加重
            width: isEnd ? 19 : 13,
            height: isEnd ? 19 : 13,
          }
          // 站名开关：关闭时不挂 label，让工具行「站名」在原生模式下也能显隐站名贴片
          if (this.showStopLabels) {
            stopMarker.label = {
              content: s.stopName,
              // 站点文字跟随方向色（青蓝/玫红），与参考图一致；底色近纯白保证浅色底图上可读
              color: st.labelText,
              fontSize: 10,
              borderRadius: 8,
              bgColor: 'rgba(255, 255, 255, 0.97)',
              padding: 4,
              textAlign: 'center',
              // uni-h5 的 label 会按方向色描一圈边，与参考图冲突；显式置透明
              borderColor: 'rgba(0, 0, 0, 0)',
              borderWidth: 0,
            }
          }
          stopMarkers.push(stopMarker)
        })
      })
      const busMarkers = []
      dirs.forEach((dir) => {
        ;(this.busesByDir[dir] || []).forEach((b, idx) => {
          // 键名必须是 latitude/longitude（否则地图内部 LngLat 报错会中断后续渲染）
          busMarkers.push({
            id: (dir + 2) * 10000 + idx,
            latitude: b.lat,
            longitude: b.lng,
            iconPath: assetUrl(`/static/bus-live-${dir}.png`),
            width: 30,
            height: 30,
            // 不给 marker 挂 callout，也**不能传 title**：uni-h5 的 MapMarker 会在点击时
            // 把 title 生成的 callout 切到可见（callout.visible = !visible），
            // 于是每点一次车图标，车头上方就多出一个“337 3240”白框，直到地图重建才消失。
            // 线路号/自编号/上下行/车速等只在详情浮窗里展示。
          })
        })
      })
      // 站点在下、车辆在上
      return [...stopMarkers, ...busMarkers]
    },
    // 营运走向：优先用道路吸附轨迹，取不到时回退站点直线
    // 每方向两层：白色外描边 + 方向色主线；下行主线用虚线，与上行贴近时也能分辨
    // 注意绘制顺序：先铺完所有外描边再画主线，否则后画方向的粗外描边会把先画方向的主线整条盖住
    polylines() {
      if (this.cityOn) return this.cityNativeNet()
      const dirs = this.dirFilter === 2 ? [0, 1] : [this.dirFilter]
      const split = dirs.length > 1 ? 14 : 0
      const casings = []
      const lines = []
      dirs.forEach((dir) => {
        let points = this.routeByDir[dir] || []
        if (points.length < 2) {
          // API 坐标已是 GCJ-02，直接用于连线
          points = (this.stopsByDir[dir] || [])
            .map((s) => ({ latitude: parseFloat(s.latitude), longitude: parseFloat(s.longitude) }))
            .filter((p) => !isNaN(p.latitude) && !isNaN(p.longitude))
        }
        if (points.length < 2) return
        const pts = offsetPolyline(points, split)
        const st = DIR_STYLE[dir]
        casings.push({ points: pts, color: st.casing, width: 9, arrowLine: false })      // 白色外描边
        // 主线统一用提亮一档的 direction 色（与自绘 svgStroke 同源）。
        // 不再给下行加 dottedLine：玫红虚线压在同一条走廊上会与青蓝主线互相打架，
        // 方向靠 14m 分轨偏移 + 色相已经能分清。
        lines.push({ points: pts, color: st.svgStroke, width: 5, arrowLine: true })
      })
      return [...casings, ...lines]
    },
    // 全市态的原生折线：视野裁剪 + 条数封顶。
    // uni-h5 每条折线都是一个独立覆盖物，1000 多条会把地图彻底拖死，所以只绘视野内的前 180 条
    // （统计行会明说这个上限，不让用户误以为全市就这些线；完整线网请用“走向图”渲染方式）
    cityNativeNet() {
      void this.viewTick
      void this.cityNetTick
      void this.cityDirty
      const net = this._net
      if (!net) return []
      const vp = this._cityViewport()
      const rect = this._cityRect(vp.w, vp.h)
      const dirs = this.pickCityDirs(rect, CITY_NET_MAX_NATIVE)
      const out = []
      for (const d of dirs) {
        if (d.n < 2) continue
        const step = Math.max(1, Math.ceil(d.n / 80))
        const points = []
        for (let i = 0; i < d.n; i += step) points.push({ latitude: d.p[i * 2 + 1], longitude: d.p[i * 2] })
        const last = d.n - 1
        if (last % step !== 0) points.push({ latitude: d.p[last * 2 + 1], longitude: d.p[last * 2] })
        if (points.length < 2) continue
        const st = DIR_STYLE[d.dir]
        out.push({ points, color: st.inner, width: this.cityFilterNo ? 5 : 2, arrowLine: false })
      }
      return out
    },
    // 所属营运公司：由当前视角在线车辆自编号（orgId）首位推断，1 → 武汉公交集团第一营运公司，依次类推
    operatorCompanies() {
      const set = new Set()
      this.shownBuses.forEach((b) => {
        const d = String(b.orgId || '').charAt(0)
        if (d >= '1' && d <= '9') set.add(Number(d))
      })
      return [...set]
        .sort((a, b) => a - b)
        // short 用于控制卡里的徽标（一行放不下全名，全名留给 title / 车辆详情窗）
        .map((no) => ({ no, short: `${CN_ORG[no]}公司`, label: `武汉公交集团${CN_ORG[no]}营运公司` }))
    },
    // 详情窗位置：拖动过后用 left/top 绝对定位（覆盖默认的居中贴底）
    sheetStyle() {
      if (!this.sheetPos) return null
      return {
        left: this.sheetPos.x + 'px',
        top: this.sheetPos.y + 'px',
        bottom: 'auto',
        transform: 'none',
      }
    },
  },
  watch: {
    // 详情窗出现后给标题栏挂上原生鼠标拖动（uni-app 对 view 的 mouse 事件绑定不可靠）
    selectedBus(v) {
      if (v) this.$nextTick(() => this.bindSheetDrag())
      else this.unbindSheetDrag()
    },
    // 地图重建（刷新 / 换方向 / 定位）会换掉 DOM，悬停监听要重新挂到新节点上
    mapKey() {
      this.$nextTick(() => this.bindHover())
    },
    // 宿主页顶部「上行/下行」切换 → 地图视角单向跟随（地图内仍可用「全部 / ⇄」自由查看）
    initDirection(v) {
      const d = Number(v || 0)
      if (d !== 2 && d !== this.dirFilter) this.setDirView(d)
    },
    // 线路号 prop 变化（如线路详情页切换线路）时，重载该线路双方向数据
    lineCodeProp(v) {
      if (v && v !== this.lineCode) {
        const no = v.split('-')[1] || ''
        if (no) this.loadByLine(no, this.direction)
      }
    },
    // 全市公交视图：宿主顶部分段是唯一入口，本组件不再自带开关
    cityMode(v) {
      if (v) { if (!this.cityOn) this.enterCity() }
      else if (this.cityOn) this.exitCity()
    },
  },
  mounted() {
    this.initFromProps()
    // #ifdef H5
    this._onWinResize = () => {
      this.syncCanvasSize()
      this.measureUi()
      // 窗口变小/旋转后详情窗可能跑到屏幕外，重新收进视口
      this.clampSheetPos()
    }
    window.addEventListener('resize', this._onWinResize)
    // #endif
    // #ifdef H5
    // 嵌入态全屏时允许按 ESC 快速退出
    if (this.embedded) {
      this._onFsKey = (e) => {
        if (e.key === 'Escape' && this.isFullscreen) this.toggleFullscreen()
      }
      window.addEventListener('keydown', this._onFsKey)
    }
    // #endif
    this.$nextTick(() => {
      this.bindGestures()
      this.bindHover()
    })
    // 拉起自动刷新定时器（组件没有 onShow，这里统一兜底启动；
    // 独立页通过 wrapper 的 onShow 转发 restartAutoRefresh 会先停后起，重复调用无害）
    this.restartAutoRefresh()
  },
  onShow() {
    // 从设置页返回后画布/绑定可能需要重建；自动刷新定时器重新拉起
    this.restartAutoRefresh()
    this.$nextTick(() => {
      this.measureUi()
      this.bindGestures()
      this.bindHover()
    })
  },
  onHide() {
    // 离开页面（如进设置页）先暂停自动刷新，回来时由 onShow 恢复
    this.stopAutoRefresh()
  },
  beforeUnmount() {
    this.cleanup()
  },
  methods: {
    // 组件/页面卸载时统一清理（解绑手势、悬停、详情窗拖动、定位定时器、自动刷新）
    cleanup() {
      // #ifdef H5
      if (this._onWinResize) window.removeEventListener('resize', this._onWinResize)
      if (this._onFsKey) window.removeEventListener('keydown', this._onFsKey)
      // 全屏状态下被卸载（如切 Tab）时，别把 body 滚动锁留在页面上
      if (this.isFullscreen) document.body.style.overflow = ''
      // #endif
      this._onWinResize = null
      this.unbindGestures()
      this.unbindHover()
      this.unbindSheetDrag()
      if (this._locTimer) clearTimeout(this._locTimer)
      // 在途的全网扫描：卸载后没人再消费它的结果，直接停掉（已扫到的部分不写缓存）
      if (this._cityToken) this._cityToken.cancelled = true
      this.stopAutoRefresh()
    },
    // 组件化入口：从 props 读取线路并首次加载（页面形态下由 mounted 调用）
    initFromProps() {
      this.lineCode = this.lineCodeProp || ''
      this.direction = Number(this.initDirection || 0)
      this.lineName = this.lineNameProp || ''
      this.lineNo = this.lineCode.split('-')[1] || this.lineName || ''
      this.searchNo = this.lineName || this.lineNo
      this._userMoved = false
      // 先量出画布尺寸与 UI 占位，再拉数据（自绘走向图依赖这些尺寸做自适应）
      this.syncCanvasSize()
      // 窄屏默认折叠车辆面板，给走向图留出绘制空间
      try {
        const info = uni.getSystemInfoSync()
        if (info.windowWidth < 720) this.panelCollapsed = true
      } catch (e) { /* 忽略 */ }
      this.$nextTick(() => this.measureUi())
      this.loadRefreshPref()
      this.loadCityPref()
      if (this.cityMode) {
        // 全市公交视图不依赖选线：本线站点/轨迹/车辆一条都不拉（没线路时拉了只会拿到 420100--0 这种垃圾编码）
        this.enterCity()
      } else {
        this.loadAllStops()
        this.loadLive()
      }
      // 编号字典就绪后刷新自编号显示（双方向缓存都要补）
      onBusIdReady(() => {
        for (const dir of [0, 1]) {
          this.busesByDir[dir] = this.busesByDir[dir].map((b) => ({
            ...b,
            orgId: decryptBusId(b.busId) || b.orgId || '',
          }))
        }
        // 全市快照可能扫于字典就绪之前，这里统一补一遍自编号明文
        if (this.cityBuses.length && refreshOrgIds(this.cityBuses)) this.cityDirty++
        // 自编号就绪后标记图文会变化，原生模式重建地图保证渲染一致；自绘模式标记走 SVG/HTML 图层，无需重建
        if (this.useMap) this.mapKey++
        // 自编号就绪后营运公司徽章才出现，控制卡会变高 → 重新量取占位
        this.$nextTick(() => this.measureUi())
      })
    },
    // 搜索框“查询”：在当前页直接切换到输入的线路（保持当前视角方向）
    doSearchMap() {
      const no = (this.searchNo || '').trim()
      if (!no) {
        uni.showToast({ title: '请输入线路号', icon: 'none' })
        return
      }
      this.loadByLine(no, this.dirFilter === 2 ? this.direction : this.dirFilter)
    },
    // 切换视角方向：0 上行 / 1 下行 / 2 全部（站点与轨迹已双方向缓存，切换仅重绘）
    // 自绘模式：走向/站点/车辆都是 SVG + HTML 图层，改 dirFilter 重算 svg* 即可，
    // 底图瓦片随 cam 不变、完全不动。地图 <map> 组件（原生模式）则需重建以切换 marker 集合，
    // 但自绘模式没有 <map>，mapKey++ 对性能无益只有徒劳开销——故自绘模式不重建。
    setDirView(d) {
      if (d !== 2) this.direction = d
      this.dirFilter = d
      if (this.useMap) this.mapKey++
      this.renderSchematic()
    },
    // 切换方向按钮：全部 → 上行 → 下行 → 全部 循环
    cycleDirView() {
      const next = this.dirFilter === 2 ? 0 : this.dirFilter === 0 ? 1 : 2
      this.setDirView(next)
      uni.showToast({ title: `视角：${this.dirFilterLabel}`, icon: 'none' })
    },
    // 在当前页加载指定线路（重建双方向站点/轨迹/实时车辆）
    loadByLine(no, dir) {
      this.lineName = no
      this.lineNo = no
      this.direction = dir
      this.lineCode = buildLineCode(no, dir)
      // 清空上一条线路的全部缓存，避免叠加
      this.stopsByDir = { 0: [], 1: [] }
      this.routeByDir = { 0: [], 1: [] }
      this.routeState = { 0: 'idle', 1: 'idle' }
      this.busesByDir = { 0: [], 1: [] }
      this.selectedBus = null
      // 新线路需要重新自适应视角（丢弃旧线路记住的视野）
      this.camInited = false
      this._userMoved = false
      this._view = null
      // 原生模式才需要重建 <map>；自绘模式 mapKey 只是标记重建的副作用键，保持不动
      if (this.useMap) this.mapKey++
      this.loadAllStops()
      this.loadLive()
    },
    // 加载双方向站点（全部模式与一次性轨迹规划都需要）
    async loadAllStops() {
      const dirs = [0, 1].filter((d) => !(this.stopsByDir[d] && this.stopsByDir[d].length))
      for (const d of dirs) {
        try {
          const data = await fetchLine(buildLineCode(this.lineNo, d))
          this.stopsByDir[d] = (data && data.stopDetailList) || []
        } catch (e) {
          this.stopsByDir[d] = []
        }
      }
      // 地图中心移到基准线路中段，保证切线路时新走向可见（无在线车辆时尤其需要）
      const stops = this.stopsByDir[this.direction] || []
      if (stops.length) {
        const mid = stops[Math.floor(stops.length / 2)]
        const mla = parseFloat(mid.latitude), mln = parseFloat(mid.longitude)
        if (!isNaN(mla) && !isNaN(mln)) this.mapCenter = { lat: mla, lng: mln }
      }
      if (!this.camInited) this.fitRoute()
      else this.renderSchematic()
      this.planRouteAlongRoads()
      // 无 Key 模式：用 OSRM 把站点连线吸附到真实道路（有缓存，失败自动回退）
      this.planRouteViaOsrm()
    },
    // 等待高德 SDK 核心就绪（限 12s）：uni-app 只加载地图核心，插件需按需再加载
    waitForAMap() {
      return new Promise((resolve, reject) => {
        const t0 = Date.now()
        const check = () => {
          if (window.AMap && typeof window.AMap.plugin === 'function') return resolve(window.AMap)
          if (Date.now() - t0 > 12000) return reject(new Error('AMap 加载超时'))
          setTimeout(check, 250)
        }
        check()
      })
    },
    // 返回上一页（嵌入式形态下由首页承载，不需要返回，直接忽略）
    goBack() {
      if (this.embedded) return
      // 地图页就是首页：没有「上一层」可回，回顶栏起始态即可
      uni.reLaunch({ url: '/pages/map/map' })
    },
    // 按需加载高德插件（LineSearch / Driving），带超时保护
    loadPlugin(AMap, name) {
      return new Promise((resolve) => {
        const cls = name.split('.')[1]
        if (AMap[cls]) return resolve(true)
        let settled = false
        const done = () => { if (!settled) { settled = true; resolve(!!AMap[cls]) } }
        try { AMap.plugin([name], done) } catch (e) { return resolve(false) }
        setTimeout(done, 8000)
      })
    },
    // 生成双方向线路轨迹：优先高德官方公交线路真实轨迹（一次搜索匹配两个方向），取不到再逐段驾车吸附兜底
    async planRouteAlongRoads() {
      if (!this.useMap) return
      try {
        const AMap = await this.waitForAMap()
        const official = await this.fetchOfficialLines(AMap)
        for (const dir of [0, 1]) {
          if (official[dir] && official[dir].length > 1) this.routeByDir[dir] = official[dir]
        }
        // 原生模式才需要重建 <map> 清 callout 残留；自绘模式没有 <map>，mapKey++ 只是徒劳
        if (this.useMap) this.mapKey++
        this.renderSchematic()
        // 官方轨迹缺失且有站点缓存的方向 → 逐段驾车吸附兜底
        for (const dir of [0, 1]) {
          const has = this.routeByDir[dir] && this.routeByDir[dir].length > 1
          const stops = this.stopsByDir[dir] || []
          if (!has && stops.length > 1) await this.planByDriving(AMap, dir)
        }
      } catch (e) {
        // 保持直线回退，不打扰用户
      } finally {
        // BYOK 模式也走同一套状态标记：几何在就是 ok，不在就是 fail（画细虚线并提示）
        for (const dir of [0, 1]) {
          this.routeState[dir] = this.routeByDir[dir] && this.routeByDir[dir].length > 1 ? 'ok' : 'fail'
        }
        this.renderSchematic()
      }
    },
    // 无 Key 模式走向吸附：OSRM 免 Key 公共路由，按线路-方向缓存 7 天；失败保持站点连线
    async planRouteViaOsrm() {
      if (this.useMap) return
      const DIRS = [0, 1]
      const todo = DIRS.filter((dir) =>
        (this.stopsByDir[dir] || []).filter((s) => !isNaN(parseFloat(s.latitude)) && !isNaN(parseFloat(s.longitude))).length > 1
      )
      if (!todo.length) return
      todo.forEach((dir) => { this.routeState[dir] = 'loading' })
      this.renderSchematic()
      for (const dir of todo) {
        const stops = (this.stopsByDir[dir] || [])
          .map((s) => ({ lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }))
          .filter((p) => !isNaN(p.lat) && !isNaN(p.lng))
        try {
          const pts = await fetchRoadRoute(stops, `${this.lineNo}-${dir}`)
          if (!pts || pts.length < 2) {
            this.routeState[dir] = 'fail'
            continue
          }
          this.routeByDir[dir] = pts
          this.routeState[dir] = 'ok'
          this.renderSchematic()
        } catch (e) {
          this.routeState[dir] = 'fail'
        }
      }
      this.renderSchematic()
    },
    toggleBaseMap() {
      this.showBaseMap = !this.showBaseMap
      this.renderSchematic()
    },
    // 按相机算出当前视口需要的高德标准瓦片（XYZ 编号，256px/张）
    renderTiles() {
      if (!this.showBaseMap) {
        if (this.tiles.length) this.tiles = []
        return
      }
      const { w, h } = this.canvas
      if (!w || !h) return
      const s = zoomScale(this.cam.zoom)
      const zt = clampNum(Math.floor(this.cam.zoom), 3, 18)
      const n = Math.pow(2, zt)
      const size = 256 * Math.pow(2, this.cam.zoom - zt)
      // 视口四边对应的瓦片编号（瓦片编号 u→x 直接用 u * 2^z，与 Mercator 同构）
      const tx0 = Math.floor((this.cam.u - this.projCenter.x / s) * n)
      const tx1 = Math.floor((this.cam.u + (w - this.projCenter.x) / s) * n)
      const ty0 = Math.floor((this.cam.v - this.projCenter.y / s) * n)
      const ty1 = Math.floor((this.cam.v + (h - this.projCenter.y) / s) * n)
      const out = []
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          if (ty < 0 || ty >= n) continue
          // 经度方向循环：越过 180° 时取模（本地用不到，但避免负数编号）
          const wx = ((tx % n) + n) % n
          const left = (tx / n - this.cam.u) * s + this.projCenter.x
          const top = (ty / n - this.cam.v) * s + this.projCenter.y
          out.push({
            key: `${zt}/${tx}/${ty}`,
            url: `https://webrd0${(Math.abs(tx + ty) % 4) + 1}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${wx}&y=${ty}&z=${zt}`,
            left: Math.round(left),
            top: Math.round(top),
            size: Math.ceil(size) + 1,
          })
        }
      }
      this.tiles = out.slice(0, 120)
    },
    // 高德官方公交线路真实轨迹：LineSearch 按线路名搜索，用各方向首站坐标就近匹配，返回 {0: pts, 1: pts}（GCJ-02）
    fetchOfficialLines(AMap) {
      return new Promise(async (resolve) => {
        const out = { 0: [], 1: [] }
        if (!this.lineName || !this.stopsByDir[0].length || !this.stopsByDir[1].length) return resolve(out)
        const ok = await this.loadPlugin(AMap, 'AMap.LineSearch')
        if (!ok) return resolve(out)
        let settled = false
        const done = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(out) } }
        const timer = setTimeout(done, 10000)
        try {
          const ls = new AMap.LineSearch({ city: '武汉', citylimit: true, types: 'BUS' })
          const toXY = (p) => ({ lng: typeof p.getLng === 'function' ? p.getLng() : p.lng, lat: typeof p.getLat === 'function' ? p.getLat() : p.lat })
          ls.search(this.lineName, (status, result) => {
            if (status !== 'complete') return done()
            const lines = (result && (result.lineInfo || result.lineList)) || []
            if (!lines.length) return done()
            // 每个方向选路径起点距该方向首站最近的轨迹（上下行各取一条，已用方向不重复选）
            const used = new Set()
            for (const dir of [0, 1]) {
              const first = this.stopsByDir[dir][0]
              const fl = parseFloat(first.latitude), fn = parseFloat(first.longitude)
              let line = null, best = Infinity
              for (const l of lines) {
                if (used.has(l)) continue
                const p0 = l.path && l.path[0]
                if (!p0) continue
                const xy = toXY(p0)
                const d = (xy.lat - fl) ** 2 + (xy.lng - fn) ** 2
                if (d < best) { best = d; line = l }
              }
              if (!line && lines.length === 1) line = lines[0]
              if (!line) continue
              used.add(line)
              out[dir] = (line.path || []).map(toXY)
                .map((xy) => ({ latitude: xy.lat, longitude: xy.lng }))
                .filter((p) => !isNaN(p.latitude) && !isNaN(p.longitude))
            }
            done()
          })
        } catch (e) { done() }
      })
    },
    // 回退方案：指定方向相邻站点逐段驾车路径规划吸附到道路（单段失败只回退那一小段）
    async planByDriving(AMap, dir) {
      // API 坐标已是 GCJ-02，直接喂给驾车规划
      const pts = (this.stopsByDir[dir] || [])
        .map((s) => ({ lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }))
        .filter((p) => !isNaN(p.lat) && !isNaN(p.lng))
      if (pts.length < 2) return
      const ok = await this.loadPlugin(AMap, 'AMap.Driving')
      if (!ok) return
      const driving = new AMap.Driving({ policy: AMap.DrivingPolicy ? AMap.DrivingPolicy.LEAST_TIME : 0 })
      const result = [{ latitude: pts[0].lat, longitude: pts[0].lng }]
      for (let i = 0; i < pts.length - 1; i++) {
        const segPts = await this.driveRoute(AMap, driving, pts[i], pts[i + 1], [])
        const use = segPts.length ? segPts : [pts[i], pts[i + 1]]
        for (const p of use) {
          const last = result[result.length - 1]
          if (!last || Math.abs(last.latitude - p.lat) > 1e-9 || Math.abs(last.longitude - p.lng) > 1e-9) {
            result.push({ latitude: p.lat, longitude: p.lng })
          }
        }
      }
      this.routeByDir[dir] = result
      if (this.useMap) this.mapKey++
      this.renderSchematic()
    },
    // 一批路径规划（含途经点）：Promise 化 + 10s 超时保护，失败返回空数组由调用方回退直线
    driveRoute(AMap, driving, origin, destination, waypoints) {
      return new Promise((resolve) => {
        let done = false
        const finish = (points) => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(points)
        }
        const timer = setTimeout(() => finish([]), 10000)
        try {
          const opts = waypoints && waypoints.length
            ? { waypoints: waypoints.map((w) => new AMap.LngLat(w.lng, w.lat)) }
            : {}
          // 高德 JS API 2.0 经纬度规划签名：search(origin, destination, opts, callback)
          driving.search(
            new AMap.LngLat(origin.lng, origin.lat),
            new AMap.LngLat(destination.lng, destination.lat),
            opts,
            (status, result) => {
              const paths = []
              try {
                if (status === 'complete' && result.routes && result.routes.length) {
                  const steps = result.routes[0].steps || []
                  steps.forEach((st) => (st.path || []).forEach((pt) => paths.push({ lat: pt.getLat(), lng: pt.getLng() })))
                }
              } catch (err) { /* 忽略解析异常，回退直线 */ }
              finish(paths)
            }
          )
        } catch (err) {
          finish([])
        }
      })
    },
    // 加载实时车辆：双方向全部在运车辆一次拉齐（标记与连线由 computed 自动生成）
    // silent = 自动刷新触发：不关详情弹层、不改地图中心（沿用用户当前视野）
    async loadLive(silent) {
      if (!this.lineNo) return
      this.loading = true
      // 先清空上一批车辆，让地图移除旧标记，避免旧位置气泡残留叠加
      this.busesByDir = { 0: [], 1: [] }
      if (!silent) this.selectedBus = null
      await this.$nextTick()
      try {
        const [up, down] = await Promise.all([this.fetchDirLive(0), this.fetchDirLive(1)])
        this.busesByDir = { 0: up, 1: down }
        if (silent) {
          // 自动刷新会重建地图（清 callout 残留），重建后回到 props 指定的中心；
          // 这里先还原用户平移/缩放后的视野，避免每隔 N 秒被拽回首辆车
          if (this._view) {
            this.mapCenter = { lat: this._view.center.lat, lng: this._view.center.lng }
            this.mapScale = this._view.scale
          }
        } else {
          // 聚焦地图到当前视角首辆车位置（API 坐标已是 GCJ-02）
          const first = this.shownBuses[0]
          if (first) this.mapCenter = { lat: first.lat, lng: first.lng }
        }
        // 重建地图组件，彻底清除上批标记与气泡残留（仅原生地图需要；自绘模式标记走 SVG/HTML 图层，无需重建）
        if (this.useMap) this.mapKey++
        // 首次拿到车辆时重新自适应（包含车辆分布），此后仅重绘避免画面跳动
        if (!this.camInited) this.fitRoute()
        // 车辆到位后营运公司徽章出现会让控制卡变高，需重新量取占位（未手动调整视角时会自动重排）
        else this.$nextTick(() => this.measureUi())
      } catch (e) {
        this.busesByDir = { 0: [], 1: [] }
      } finally {
        this.loading = false
      }
    },
    // 拉取并解析某方向在线车辆
    async fetchDirLive(dir) {
      const data = await fetchRealTime(buildLineCode(this.lineNo, dir))
      const list = (data && data.lineBusDtoList) || []
      const out = []
      list.forEach((b) => {
        const lat = parseFloat(b.latitude)
        const lng = parseFloat(b.longitude)
        if (isNaN(lat) || isNaN(lng)) return
        // 还原加密车辆编号
        const orgId = decryptBusId(b.busId)
        out.push({
          dir,
          busId: b.busId,
          busNo: b.busNo,
          orgId: orgId || '',
          gpsSpeed: b.gpsSpeed,
          arrived: b.arrived,
          time: this.formatGpsTime(b.gpsTime),
          lat,
          lng,
        })
      })
      return out
    },
    // —— 刷新间隔：手动 / 15s / 20s / 30s ——
    // 读回上次选择（存储不可用或值非法时保持手动刷新）
    loadRefreshPref() {
      try {
        const v = Number(uni.getStorageSync(REFRESH_KEY))
        if (REFRESH_OPTS.includes(v)) this.refreshSec = v
      } catch (e) { /* 忽略 */ }
    },
    // 单击 ↻：立即拉一次（自动刷新模式下也用于手动补一次）
    refreshNow() {
      if (this.loading) return
      this.loadLive()
    },
    // 选择刷新间隔：0 手动 / 15 / 20 / 30 秒
    setRefreshSec(sec) {
      this.refreshMenu = false
      if (sec === this.refreshSec) {
        this.restartAutoRefresh()
        return
      }
      this.refreshSec = sec
      try {
        uni.setStorageSync(REFRESH_KEY, sec)
      } catch (e) { /* 忽略 */ }
      this.restartAutoRefresh()
      // 切到自动模式立刻拉一次，不必等满一个间隔才看到变化
      if (sec > 0) this.loadLive(true)
      uni.showToast({ title: sec > 0 ? `已开启：每 ${sec} 秒自动刷新` : '已改为手动刷新', icon: 'none' })
    },
    // 重建定时器（0 = 手动，不建定时器）
    restartAutoRefresh() {
      this.stopAutoRefresh()
      if (this.refreshSec) {
        this._autoTimer = setInterval(() => {
          // 详情弹层打开时跳过，别把正在看的车辆信息刷没了
          if (this.selectedBus) return
          this.loadLive(true)
        }, this.refreshSec * 1000)
      }
      // 全市自动跟随：与线路刷新各自独立（一轮扫描代价高，档位最低 5 分钟且默认关）
      if (this.cityOn && this.cityFollow > 0) {
        this._cityTimer = setInterval(() => {
          if (this.cityBusy || this.selectedBus) return
          this.runCity(true)
        }, this.cityFollow * 60000)
      }
    },
    stopAutoRefresh() {
      if (this._autoTimer) {
        clearInterval(this._autoTimer)
        this._autoTimer = null
      }
      if (this._cityTimer) {
        clearInterval(this._cityTimer)
        this._cityTimer = null
      }
    },
    // —— 全市公交视图：线网底图 / 快照 / 图层 / 双查询 ——
    async enterCity() {
      this.cityOn = true
      this.selectedBus = null
      // 全市取景与本线取景是两套，进来先作废上一次的自适应标记与视野
      this.camInited = false
      this._userMoved = false
      this._view = null
      this.loadCityPref()
      // 线网是静态资产（不占 API 配额），与快照并行拉取：到位后自己重排
      this.ensureCityNet()
      this.restartAutoRefresh()
      // 有旧快照就先拿出来看（零请求），只有真要扫的时候才告知代价
      const last = loadLastSnapshot()
      if (last) {
        this.applyCity(last)
        this.fitCity()
        const mins = Math.max(1, Math.round(snapshotAge(last) / 60000))
        uni.showToast({ title: `展示 ${mins} 分钟前的快照 · 点 ↻ 可重扫`, icon: 'none' })
        return
      }
      // 还没扫过：先把视野摆到全市线网，这一分钟等待里至少有个画面而不是空屏
      this.fitCity()
      if (!cityWarned()) {
        const go = await this.confirmCitySweep()
        if (!go) {
          // 用户不认这笔代价：交回宿主退出本视图（档位判据只留在宿主一处）
          this.$emit('exit-city')
          return
        }
      }
      await this.runCity(false)
    },
    exitCity() {
      this.cancelCity()
      this.cityOn = false
      this.cityDots = []
      this.cityNetPaths = []
      this.cityTags = []
      this.cityFilterNo = ''
      this.cityQueryNo = ''
      this.cityFindNo = ''
      this.cityHitLine = null
      this.selectedBus = null
      // 回到线路视图：清掉全市视野与“用户已移动”标记，重新量占位并自适应整条线
      this.camInited = false
      this._userMoved = false
      this._view = null
      this.restartAutoRefresh()
      if (this.useMap) this.mapKey++
      this.$nextTick(() => this.measureUi())
    },
    // 首次使用的代价告知：后端没有全市接口，一轮 = cityCost 个请求（线网底图是静态文件，不计在内）
    confirmCitySweep() {
      return new Promise((resolve) => {
        markCityWarned()
        uni.showModal({
          title: '全市公交：拉取在运车辆',
          content: `线网走向读本地静态底图（零请求）；但后端没有全市车辆接口，车辆位置需逐方向拉取：本次约发 ${this.cityCost} 个请求、耗时 1 分钟左右。之后 90 秒内重复进入直接复用缓存。`,
          confirmText: '开始扫描',
          cancelText: '只看线网',
          success: (r) => resolve(!!r.confirm),
          fail: () => resolve(true),
        })
      })
    },
    loadCityPref() {
      try {
        const v = Number(uni.getStorageSync(CITY_FOLLOW_KEY))
        if (CITY_FOLLOW_OPTS.includes(v)) this.cityFollow = v
        const t = uni.getStorageSync('whbis:city-tags')
        if (t !== '' && t != null) this.cityShowOrgId = Number(t) !== 0
      } catch (e) { /* 存储不可用保持默认 */ }
    },
    // 载入全市线网底图。几何本体挂 this._net 而不是 data：五万多个数字进 Vue 深代理
    // 会拖慢每一帧，而且它加载完就不再变，变的只是相机。
    ensureCityNet() {
      if (this._net) return Promise.resolve(this._net)
      if (this._netPromise) return this._netPromise
      this.cityNetBusy = true
      this._netPromise = loadCityNet()
        .then((net) => {
          this.cityNetBusy = false
          this._netPromise = null
          if (!net) return null
          // 预投影：经纬度一次性换成 Mercator 单位坐标，重绘时只剩「减相机 + 乘缩放」
          for (const d of net.dirs) {
            const n = d.n
            const mu = new Float64Array(n)
            const mv = new Float64Array(n)
            for (let i = 0; i < n; i++) {
              mu[i] = mercX(d.p[i * 2])
              mv[i] = mercY(d.p[i * 2 + 1])
            }
            d.mu = mu
            d.mv = mv
          }
          this._net = net
          this.cityNetStat = { count: net.count, dirCount: net.dirCount, stopCount: net.stopCount, updated: net.updated }
          this.cityNetTick++
          if (!this.cityOn) return net
          // 底图比快照晚到时，不该把用户已经拖到的视野抢回来
          if (!this.camInited) this.fitCity()
          else this.renderSchematic()
          if (this.useMap) this.mapKey++
          return net
        })
        .catch(() => {
          this.cityNetBusy = false
          this._netPromise = null
          return null
        })
      return this._netPromise
    },
    // 当前视口的经纬矩形（两种渲染模式的视野来源不同：原生看 _view，自绘看 cam）
    _cityRect(w, h) {
      let s
      let u0
      let v0
      if (this.useMap) {
        const v = this._view || {}
        s = zoomScale(v.scale || this.mapScale || 13)
        const c = v.center || this.mapCenter
        u0 = mercX(c.lng) - (w / 2) / s
        v0 = mercY(c.lat) - (h / 2) / s
      } else {
        s = zoomScale(this.cam.zoom)
        u0 = this.cam.u - this.projCenter.x / s
        v0 = this.cam.v - this.projCenter.y / s
      }
      return {
        minLng: invMercX(u0),
        maxLng: invMercX(u0 + w / s),
        // Mercator 的 v 向南增大，所以矩形上边 v0 对应最高纬度
        minLat: invMercY(v0 + h / s),
        maxLat: invMercY(v0),
      }
    },
    // 视口内要绘的方向：先按包围盒裁剪，超预算时留站点多的（主干线视觉权重更高）
    pickCityDirs(rect, cap) {
      const net = this._net
      if (!net) return []
      const q = String(this.cityFilterNo || '').trim()
      const hit = []
      for (const d of net.dirs) {
        if (q && String(d.no) !== q && String(d.code) !== q) continue
        if (!bboxIntersects(d.bb, rect)) continue
        hit.push(d)
      }
      if (hit.length <= cap) return hit
      hit.sort((a, b) => b.n - a.n)
      return hit.slice(0, cap)
    },
    // 全市线网走向（自绘模式）：远景按方向色合并成两条巨路径，近景逐条；
    // 命中线路号筛选时永远逐条加重，否则单条走向会被网络纹理漫掉。
    renderCityNet(s, w, h) {
      const net = this._net
      if (!net) {
        this.cityNetPaths = []
        return
      }
      const rect = this._cityRect(w, h)
      const fuse = this.cam.zoom < CITY_NET_FUSE_ZOOM
      const detail = !!String(this.cityFilterNo || '').trim() || !fuse
      const dirs = this.pickCityDirs(rect, fuse && !detail ? net.dirCount : CITY_NET_MAX_PATHS)
      let total = 0
      for (const d of dirs) total += d.n
      // 点预算：整张网络的投影点数封顶，超出就按整条线等距抽稀
      const step = total > CITY_NET_MAX_PTS ? Math.ceil(total / CITY_NET_MAX_PTS) : 1
      const cu = this.cam.u
      const cv = this.cam.v
      const cx = this.projCenter.x
      const cy = this.projCenter.y
      const buf = [[], []]
      const per = []
      for (const d of dirs) {
        const n = d.n
        if (n < 2) continue
        const seg = []
        for (let i = 0; i < n; i += step) {
          const x = (d.mu[i] - cu) * s + cx
          const y = (d.mv[i] - cv) * s + cy
          seg.push((i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1))
        }
        if ((n - 1) % step !== 0) {
          const x = (d.mu[n - 1] - cu) * s + cx
          const y = (d.mv[n - 1] - cv) * s + cy
          seg.push('L' + x.toFixed(1) + ' ' + y.toFixed(1))
        }
        if (detail) per.push({ key: d.code + '-' + d.dir, d: seg.join(''), color: DIR_STYLE[d.dir].svgStroke, w: 4, op: 1 })
        else buf[d.dir].push(seg.join(''))
      }
      const paths = per
      // 合并层的参数：远景细淡（1000 多条叠在一起靠密度说话），近景逐条才会加重
      for (const dir of [1, 0]) {
        if (!buf[dir].length) continue
        paths.unshift({ key: 'fuse' + dir, d: buf[dir].join(''), color: DIR_STYLE[dir].svgStroke, w: 1.3, op: 0.6 })
      }
      this.cityNetPaths = paths
    },
    // 自编号标签（自绘模式）：只在近景出现，并做像素级避让，数量封顶
    buildCityTags(dots) {
      if (!this.cityShowOrgId) return []
      if (this.cam.zoom < CITY_TAG_MIN_ZOOM) return []
      const cands = dots.filter((d) => d.bus && d.bus.orgId)
      // 选中/刚定位的车优先占位，其余按速度档高到低（快车的自编号更有意义）
      cands.sort((a, b) => (this._tagPri(b.bus) - this._tagPri(a.bus)) || (b.bus.band - a.bus.band))
      const taken = []
      const out = []
      for (const d of cands) {
        if (out.length >= CITY_TAG_MAX) break
        const text = String(d.bus.orgId)
        const bw = textW(text) * 0.8
        const y = d.y - 17
        const box = { x1: d.x - bw / 2, x2: d.x + bw / 2, y1: y - 6, y2: y + 6 }
        if (taken.some((b) => !(box.x2 <= b.x1 || b.x2 <= box.x1 || box.y2 <= b.y1 || b.y2 <= box.y1))) continue
        taken.push(box)
        out.push({ key: text + '-' + d.bus.busId, x: d.x, y, text, color: SPEED_BANDS[d.bus.band].color, sel: d.bus === this.selectedBus })
      }
      return out
    },
    _tagPri(bus) {
      if (bus === this.selectedBus) return 3
      if (bus === this.locatedBus) return 2
      return 1
    },
    toggleCityTags() {
      this.cityShowOrgId = !this.cityShowOrgId
      try {
        uni.setStorageSync('whbis:city-tags', this.cityShowOrgId ? 1 : 0)
      } catch (e) { /* 忽略 */ }
      this.renderSchematic()
      if (this.useMap) this.mapKey++
    },
    // 跑一轮全网扫描（force = 跳过新鲜期缓存直接重扫）
    async runCity(force) {
      if (this.cityBusy) return
      if (!this.cityOn) this.cityOn = true
      if (!force) {
        const fresh = loadSnapshot(CITY_FRESH_MS)
        if (fresh) {
          this.applyCity(fresh)
          this.fitCity()
          return
        }
      }
      this.cityBusy = true
      this.cityProgress = 0
      this.cityFound = 0
      const token = { cancelled: false }
      this._cityToken = token
      try {
        const snap = await sweepCity({
          token,
          onProgress: (p) => {
            this.cityProgress = Math.round((p.done / p.total) * 100)
            this.cityFound = p.buses
          },
        })
        // 中途已退出全市（或切了线路）就别把结果往线路上盖
        if (!this.cityOn) return
        this.applyCity(snap)
        // 被取消/有失败方向时不抢用户视野（他可能已经在看某一角）
        if (!snap.partial) this.fitCity()
        uni.showToast({
          title: snap.partial ? `已中止：拿到 ${snap.count} 辆` : `全市扫描完成：${snap.count} 辆在运`,
          icon: 'none',
        })
      } catch (e) {
        uni.showToast({ title: '扫描失败：' + ((e && e.message) || e), icon: 'none' })
      } finally {
        this.cityBusy = false
        this.cityProgress = 0
        this._cityToken = null
      }
    },
    cancelCity() {
      if (this._cityToken) this._cityToken.cancelled = true
    },
    // 把快照装进视图（不动视野，交给调用方决定要不要 fit）
    applyCity(snap) {
      this.cityMeta = {
        at: snap.at,
        ms: snap.ms,
        total: snap.total,
        done: snap.done,
        failed: snap.failed,
        lines: snap.lines,
        count: snap.count,
        partial: !!snap.partial,
      }
      this.cityBuses = snap.buses || []
      // 详情窗可能开着上一批的对象，跟到新对象上，跟不到就关掉
      if (this.selectedBus) {
        const again = this.cityBuses.find((b) => b.busId === this.selectedBus.busId)
        this.selectedBus = again || null
      }
      if (this.useMap) this.mapKey++
      else this.renderSchematic()
    },
    // 全市视野：筛选命中某条线时按那条线取景，否则按车辆包围盒；两者都还没到位就落到线网整体
    fitCity() {
      const q = String(this.cityFilterNo || '').trim()
      const pts = []
      const net = this._net
      if (q && net) {
        for (const d of net.dirs) {
          if (String(d.no) !== q && String(d.code) !== q) continue
          for (let i = 0; i + 1 < d.p.length; i += 2) pts.push({ lat: d.p[i + 1], lng: d.p[i] })
        }
      }
      const list = q ? this.cityShown : this.cityBuses
      if (!pts.length) {
        if (!list.length) {
          // 刚进视图、连快照都没有：用线网整体包围盒，至少把武汉市框住
          const bb = net && net.bbox
          if (!bb) return
          this._userMoved = false
          this.fitPoints([{ lat: bb[1], lng: bb[0] }, { lat: bb[3], lng: bb[2] }])
          this.camInited = true
          return
        }
        // 一千多辆全进包围盒没必要，等距抽 200 个点足够定边界
        const step = Math.max(1, Math.ceil(list.length / 200))
        for (let i = 0; i < list.length; i += step) pts.push({ lat: list[i].lat, lng: list[i].lng })
      } else {
        // 命中线路的在运车辆一并包进来（它们可能在端点外的区间车上）
        for (const b of list) pts.push({ lat: b.lat, lng: b.lng })
      }
      this._userMoved = false
      this.fitPoints(pts)
      this.camInited = true
    },
    // 全市态的原生标记：先按当前视野裁剪，再做像素网格聚合，最后按速度分档取图标。
    // 1300 个 DOM marker 会把 <map> 拖垮，聚合后稳定在两三百个。
    cityNativeMarkers() {
      void this.viewTick // _view 不是响应式的，靠这个计数感知平移/缩放后重算
      void this.cityDirty // 自编号补完也算内容变更
      const list = this.cityShown
      const hit = new Map()
      this._cityHit = hit
      if (!list.length) return []
      // 裁剪区用宿主 <map> 的实测矩形：嵌入态下它不是整窗，this.canvas 只作兜底
      const vp = this._cityViewport()
      const w = vp.w
      const h = vp.h
      const items = []
      const pad = 40
      for (const b of list) {
        const p = this._projectTo(b.lat, b.lng, w, h)
        if (p.x < -pad || p.y < -pad || p.x > w + pad || p.y > h + pad) continue
        items.push({ x: p.x, y: p.y, b })
      }
      const scale = (this._view && this._view.scale) || this.mapScale || 13
      const cell = scale >= CITY_CLUSTER_MIN_ZOOM ? 0 : CITY_CELL_NATIVE
      // 近景才给单车标自编号：1300 个 label 覆盖物会把 <map> 压死
      const showTag = this.cityShowOrgId && scale >= CITY_TAG_MIN_SCALE
      let tagCount = 0
      const out = []
      clusterPoints(items, cell).forEach((c, i) => {
        if (c.bus) {
          const id = CITY_DOT_ID + i
          const marker = {
            id,
            latitude: c.bus.lat,
            longitude: c.bus.lng,
            // 同样不传 title：uni-h5 会在点击时把 title 生成的 callout 切到可见
            iconPath: assetUrl(`/static/bus-city-${c.bus.band}.png`),
            width: 15,
            height: 15,
          }
          if (showTag && tagCount < CITY_TAG_MAX && c.bus.orgId) {
            tagCount++
            marker.label = {
              content: String(c.bus.orgId),
              color: '#0B1020',
              fontSize: 10,
              borderRadius: 8,
              bgColor: 'rgba(255, 255, 255, 0.95)',
              padding: 3,
              textAlign: 'center',
              borderColor: 'rgba(0, 0, 0, 0)',
              borderWidth: 0,
            }
          }
          out.push(marker)
          hit.set(id, { bus: c.bus })
        } else {
          const id = CITY_CLUSTER_ID + i
          const ll = this._unproject(c.x, c.y, w, h)
          out.push({
            id,
            latitude: ll.lat,
            longitude: ll.lng,
            iconPath: assetUrl('/static/bus-city-cluster.png'),
            width: 30,
            height: 30,
            label: {
              content: String(c.n),
              color: '#FFFFFF',
              fontSize: 11,
              fontWeight: 'bold',
              borderRadius: 12,
              bgColor: 'rgba(99, 102, 241, 0.92)',
              padding: 3,
              textAlign: 'center',
              borderColor: 'rgba(0, 0, 0, 0)',
              borderWidth: 0,
            },
          })
          hit.set(id, { lat: ll.lat, lng: ll.lng, n: c.n })
        }
      })
      return out
    },
    // 全市裁剪/聚合用的视口尺寸：优先取当前渲染宿主元素的实测矩形
    _cityViewport() {
      const host = this._hoverHostEl()
      const r = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null
      if (r && r.width > 1 && r.height > 1) return { w: r.width, h: r.height }
      return this.canvas
    },
    // 屏幕像素 → 经纬度（_projectTo 的逆运算）：聚合团要把它换算回中心点才能定位
    _unproject(x, y, w, h) {
      if (this.useMap) {
        const v = this._view || {}
        const s = zoomScale(v.scale || this.mapScale || 13)
        const c = v.center || this.mapCenter
        return {
          lat: invMercY(mercY(c.lat) + (y - h / 2) / s),
          lng: invMercX(mercX(c.lng) + (x - w / 2) / s),
        }
      }
      const s = zoomScale(this.cam.zoom)
      return {
        lat: invMercY(this.cam.v + (y - this.projCenter.y) / s),
        lng: invMercX(this.cam.u + (x - this.projCenter.x) / s),
      }
    },
    // 自绘模式下的车点/聚合团点击
    onCityDotTap(d) {
      if (this._suppressClick) return
      if (d.bus) {
        this.selectBus(d.bus)
        return
      }
      // 聚合团：以该点为锚放大，把团展开成单车
      this.zoomAt(d.x, d.y, 1.2)
    },
    // 自编号查车：正向 MD5 在快照里命中（无需等编号字典）
    cityFind() {
      const q = String(this.cityFindNo || '').trim()
      if (!q) {
        uni.showToast({ title: '请输入车辆自编号', icon: 'none' })
        return
      }
      const b = findBusByOrgId(q, this.cityBuses)
      if (!b) {
        uni.showToast({ title: `快照里没有自编号 ${q} 的车（已收班/回场，或不在本次扫描里）`, icon: 'none' })
        return
      }
      // 筛选会把它藏起来，先整组清掉再定位（连线路号输入框一起，否则输入框还留着上一次的筛选）
      this.cityFilterNo = ''
      this.cityQueryNo = ''
      this.cityHitLine = null
      this.selectBus(b)
      this.focusBus(b)
    },
    // 线路号查走向：命中线网就把画面收到那条线（只绘它的两个方向）；
    // 底图里没有这条几何、但快照里有它的车时退化成「只筛车」，两者都空才报未命中
    cityQueryLine() {
      const raw = String(this.cityQueryNo || '').trim()
      if (!raw) {
        uni.showToast({ title: '请输入线路号，如 578 / 电1', icon: 'none' })
        return
      }
      const hit = netSearchLines(raw, 1)[0] || null
      if (!hit) {
        const inSnap = this.cityBuses.some((b) => String(b.no).includes(raw) || String(b.code) === raw)
        if (!inSnap) {
          uni.showToast({ title: `线网与在运车辆里都没有「${raw}」`, icon: 'none' })
          this.clearCityQuery()
          return
        }
        this.cityHitLine = null
        this.cityFilterNo = raw
        this._applyCityFilter(true)
        uni.showToast({ title: `「${raw}」暂无走向数据，已按在运车辆筛选`, icon: 'none' })
        return
      }
      // 归一成线网里的真实线路号：lineCode 与展示线路号不是一回事（1001 是电1、2001 是 J1），
      // 拿用户敲进去的数字段去精确匹配会一条都不中
      this.cityQueryNo = hit.no
      this.cityHitLine = hit
      this.cityFilterNo = hit.no
      this.selectedBus = null
      this._applyCityFilter(true)
      uni.showToast({ title: `${hit.no} 路 · ${hit.dirs.length} 个方向 · 已定位走向`, icon: 'none' })
    },
    // 清除线路筛选，看回全市（不动视野：用户可能正盯着某个角落）
    clearCityQuery() {
      if (!this.cityFilterNo && !this.cityHitLine) {
        this.cityQueryNo = ''
        return
      }
      this.cityQueryNo = ''
      this.cityHitLine = null
      this.cityFilterNo = ''
      this._applyCityFilter(false)
    },
    // 筛选一变就要重取景 + 重算图层：原生靠重建 <map>（折线是 computed），自绘直接排一次
    _applyCityFilter(fit) {
      if (fit) {
        this.camInited = false
        this._userMoved = false
        this.fitCity()
      }
      if (this.useMap) this.mapKey++
      else this.renderSchematic()
    },
    // 循环切换自动跟随：关 → 5 → 15 → 30 分钟
    cycleCityFollow() {
      const i = CITY_FOLLOW_OPTS.indexOf(this.cityFollow)
      const next = CITY_FOLLOW_OPTS[(i + 1 + CITY_FOLLOW_OPTS.length) % CITY_FOLLOW_OPTS.length]
      this.cityFollow = next
      try {
        uni.setStorageSync(CITY_FOLLOW_KEY, next)
      } catch (e) { /* 忽略 */ }
      this.restartAutoRefresh()
      uni.showToast({
        title: next ? `已开启：每 ${next} 分钟重扫全网（请求量较大）` : '已关闭自动跟随',
        icon: 'none',
      })
    },
    // 从一辆车跳到它所属的线路（交给宿主换线，同时退出全市图层）
    openCityLine(bus) {
      if (!bus || !bus.code) return
      this.exitCity()
      this.$emit('pick-line', {
        lineCode: buildLineCode(bus.code, bus.dir),
        lineName: bus.no || bus.code,
        direction: Number(bus.dir || 0),
        startStop: '',
        endStop: '',
      })
    },
    // 原生地图平移/缩放后记住视野，供自动刷新重建地图时还原
    onRegionChange(e) {
      const d = (e && e.detail) || {}
      const c = d.centerLocation || d.center
      if (!c || c.latitude == null || c.longitude == null) return
      this._view = {
        center: { lat: Number(c.latitude), lng: Number(c.longitude) },
        scale: d.scale != null ? Number(d.scale) : this.mapScale,
      }
      // 全市聚合以屏幕像素为网格，视野一变裁剪与团心全部跟着变，必须 bump 一下才能重算 marker
      if (this.cityOn) this.viewTick++
    },
    // —— 自绘走向图：画布尺寸 / 相机 / 手势交互 ——
    syncCanvasSize() {
      // #ifdef H5
      this.canvas = { w: window.innerWidth, h: window.innerHeight }
      // #endif
      // #ifndef H5
      try {
        const info = uni.getSystemInfoSync()
        this.canvas = { w: Math.round(info.windowWidth), h: Math.round(info.windowHeight) }
      } catch (e) { /* 保留默认尺寸 */ }
      // #endif
      this.projCenter = { x: this.canvas.w / 2, y: this.canvas.h / 2 }
      this.renderSchematic()
    },
    // 量取控制卡 / 右侧栏（车辆面板 + 时刻表面板）/ 图例实际占位（此项目样式用 rpx，不能用固定 px 推算）
    measureUi() {
      const q = uni.createSelectorQuery().in(this)
      q.select('.ctrl').boundingClientRect()
      q.select('.side-col').boundingClientRect()
      q.select('.schematic-legend').boundingClientRect()
      q.select('.schematic').boundingClientRect()
      q.select('.city-legend').boundingClientRect()
      q.exec((res) => {
        const arr = res || []
        const prevCtrl = this.uiRects.ctrl
        const prevSide = this.uiRects.side
        this.uiRects = { ctrl: arr[0] || null, side: arr[1] || null, legend: arr[2] || arr[4] || null }
        // H5 有原生标题栏（--window-top），窗口高度不等于画布高度，以实际画布矩形为准
        const box = arr[3]
        const prevCanvas = this.canvas
        if (box && box.width && box.height) {
          this.canvas = { w: Math.round(box.width), h: Math.round(box.height) }
        }
        // 控制卡/面板高度会随异步数据（营运公司徽章、车辆数）变化，画布也可能因窗口缩放变化；
        // 占位变了就得重排，但用户已手动平移/缩放时保持其视角不动
        const changed = (prev, now) => !!(prev && now && Math.abs(now.bottom - prev.bottom) > 8)
        const grew = changed(prevCtrl, this.uiRects.ctrl) || changed(prevSide, this.uiRects.side)
        const resized = prevCanvas.w !== this.canvas.w || prevCanvas.h !== this.canvas.h
        if (!this.camInited || ((grew || resized) && !this._userMoved)) this.fitRoute()
        else this.renderSchematic()
      })
    },
    // 可绘制矩形：避开左上控制卡、右侧栏（桌面）/ 底部横栏（手机）、底部图例
    fitRect() {
      const { w, h } = this.canvas
      const c = this.uiRects.ctrl
      const p = this.uiRects.side
      const lg = this.uiRects.legend
      let x0 = 28
      let y0 = c ? Math.min(c.bottom + 26, h * 0.58) : h * 0.3
      let x1 = w - 28
      let y1 = h - ((lg ? lg.height : 30) + 40)
      if (p) {
        if (p.top > h * 0.5) y1 = Math.min(y1, p.top - 24)
        else if (p.width < w * 0.5) x1 = Math.min(x1, w - p.width - 46)
      }
      if (x1 - x0 < 220) { x0 = 20; x1 = w - 20 }
      if (y1 - y0 < 200) { y0 = Math.min(y0, Math.max(60, h * 0.2)); y1 = h - 80 }
      return { x0, y0, x1, y1 }
    },
    // 相机自适应到整条线路（含在线车辆），并让线路中心落在可绘制区域中心
    fitRoute() {
      // 全市态下“全览”览的是车点包围盒，不能拿本线站点把视野拽回去
      if (this.cityOn) { this.fitCity(); return }
      const pts = []
      ;[0, 1].forEach((d) => {
        ;(this.stopsByDir[d] || []).forEach((st) => {
          const lat = parseFloat(st.latitude)
          const lng = parseFloat(st.longitude)
          if (!isNaN(lat) && !isNaN(lng)) pts.push({ lat, lng })
        })
      })
      this.shownBuses.forEach((b) => pts.push({ lat: b.lat, lng: b.lng }))
      this.fitPoints(pts)
    },
    // 把一组点装进可绘制区（线路全览与全市分布共用同一套换算）
    fitPoints(pts) {
      if (!pts.length) { this.renderSchematic(); return }
      const us = pts.map((p) => mercX(p.lng))
      const vs = pts.map((p) => mercY(p.lat))
      const minU = Math.min(...us), maxU = Math.max(...us)
      const minV = Math.min(...vs), maxV = Math.max(...vs)
      const rect = this.fitRect()
      const availW = Math.max(160, rect.x1 - rect.x0)
      const availH = Math.max(160, rect.y1 - rect.y0)
      const sFit = Math.min(availW / Math.max(maxU - minU, 1e-7), availH / Math.max(maxV - minV, 1e-7))
      this.cam = {
        u: (minU + maxU) / 2,
        v: (minV + maxV) / 2,
        zoom: clampNum(Math.log2(sFit / 256), 8, 18.5),
      }
      this.projCenter = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 }
      this.camInited = true
      // 原生 <map> 不走 cam 相机，必须单独换算 scale/center：
      // 不写的话 mapScale 会永远停在 data 里的初始值 13，跨区线路（如 337 横跨汉阳—武昌）
      // 就被压成屏幕中间一小团，是「走向图不好看」最主要的原因。
      this.fitNativeView(pts, rect)
      this.renderSchematic()
    },
    // 原生地图视野自适应：按线路包围盒选出「刚好装下整条线」的最大 scale
    // 可绘制区沿用 fitRect()（已扣掉左上控制卡与右侧车辆面板的遮挡），
    // 中心也要按可绘制区中心反算，否则线路会被控制卡压住一半。
    fitNativeView(pts, rect) {
      if (!this.useMap || !pts.length) return
      const us = pts.map((p) => mercX(p.lng))
      const vs = pts.map((p) => mercY(p.lat))
      const minU = Math.min(...us), maxU = Math.max(...us)
      const minV = Math.min(...vs), maxV = Math.max(...vs)
      const availW = Math.max(160, rect.x1 - rect.x0)
      const availH = Math.max(160, rect.y1 - rect.y0)
      const sFit = Math.min(availW / Math.max(maxU - minU, 1e-7), availH / Math.max(maxV - minV, 1e-7))
      const raw = Math.log2(sFit / 256)
      // 上限 16：再大站名就会挤爆；下限 9：极短线路（单站/环线）也不至于贴到一栋楼
      const scale = clampNum(Math.round(raw), 9, 16)
      const s = zoomScale(scale)
      const cw = this.canvas.w
      const ch = this.canvas.h
      const cu = (minU + maxU) / 2 - ((rect.x0 + rect.x1) / 2 - cw / 2) / s
      const cv = (minV + maxV) / 2 - ((rect.y0 + rect.y1) / 2 - ch / 2) / s
      this.mapScale = scale
      this.mapCenter = { lat: invMercY(cv), lng: invMercX(cu) }
      // 同步 _view：否则紧接着的 silent 刷新会按旧视野把画面拽回初始中心
      this._view = { center: this.mapCenter, scale }
      // fitNativeView 仅在原生地图分支被调用（useMap 为真），此处重建是原生地图的正常行为
      if (this.useMap) this.mapKey++
    },
    resetView() {
      // 全览：清掉“用户已调整视角”标记并重新自适应（全市态下览的是车点包围盒）
      this._userMoved = false
      this.camInited = false
      // 先重新量取占位，再自适应（控制卡可能已经变了高度）
      this.measureUi()
    },
    toggleLabels() {
      this.showStopLabels = !this.showStopLabels
      // 原生模式站名挂在 marker.label 上，markers 重算后需重建 <map> 才可靠刷新；自绘模式重算图层即可
      if (this.useMap) this.mapKey++
      else this.renderSchematic()
    },
    zoomBy(dz) {
      // 原生地图：不走自绘相机，直接加减 <map> 的 scale 层级并重建。
      // 以「当前视野」为基准（用户可能已平移过），只改缩放、保持中心不动，避免跳回旧中心。
      if (this.useMap) {
        this._userMoved = true
        const cur = this._view || { center: this.mapCenter, scale: this.mapScale }
        const center = cur.center || this.mapCenter
        const step = dz > 0 ? 1 : -1
        const scale = clampNum((cur.scale || this.mapScale || 13) + step, 4, 19)
        if (scale === this.mapScale) return
        this.mapCenter = { lat: center.lat, lng: center.lng }
        this.mapScale = scale
        this._view = { center: this.mapCenter, scale }
        this.mapKey++
        return
      }
      this.zoomAt(this.canvas.w / 2, this.canvas.h / 2, dz)
    },
    // 以 (px,py) 为锚点缩放：锚点下的地理位置保持不动
    zoomAt(px, py, dz) {
      this._userMoved = true
      const s0 = zoomScale(this.cam.zoom)
      const uUnder = this.cam.u + (px - this.projCenter.x) / s0
      const vUnder = this.cam.v + (py - this.projCenter.y) / s0
      const zoom = clampNum(this.cam.zoom + dz, 8, 18.5)
      const s1 = zoomScale(zoom)
      this.cam = {
        u: uUnder - (px - this.projCenter.x) / s1,
        v: vUnder - (py - this.projCenter.y) / s1,
        zoom,
      }
      this.renderSchematic()
    },
    // 指针坐标 → 画布内坐标（鼠标 / 触摸统一处理）
    _pointOf(t) {
      const x = t.clientX != null ? t.clientX : t.pageX
      const y = t.clientY != null ? t.clientY : t.pageY
      const r = this._rect || { left: 0, top: 0 }
      return { x: x - r.left, y: y - r.top }
    },
    _eventPoint(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e
      return this._pointOf(t)
    },
    _cacheRect(e) {
      try {
        const el = e.currentTarget
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
        if (r) this._rect = { left: r.left, top: r.top }
      } catch (err) { /* 忽略 */ }
      if (!this._rect) this._rect = { left: 0, top: 0 }
    },
    // 原生手势监听：uni-app H5 对 view 的 wheel / mouse 事件绑定不可靠，直接绑定 DOM
    bindGestures() {
      const el = document.querySelector('.schematic')
      if (!el || this._boundEl === el) return
      this.unbindGestures()
      this._boundEl = el
      el.style.touchAction = 'none'
      el.addEventListener('mousedown', this.onDragStart)
      el.addEventListener('mousemove', this.onDragMove)
      el.addEventListener('mouseup', this.onDragEnd)
      el.addEventListener('mouseleave', this.onDragEnd)
      el.addEventListener('wheel', this.onWheel, { passive: false })
      el.addEventListener('touchstart', this.onTouchStart, { passive: true })
      el.addEventListener('touchmove', this.onTouchMove, { passive: false })
      el.addEventListener('touchend', this.onTouchEnd)
      el.addEventListener('touchcancel', this.onTouchEnd)
    },
    unbindGestures() {
      const el = this._boundEl
      if (!el) return
      el.removeEventListener('mousedown', this.onDragStart)
      el.removeEventListener('mousemove', this.onDragMove)
      el.removeEventListener('mouseup', this.onDragEnd)
      el.removeEventListener('mouseleave', this.onDragEnd)
      el.removeEventListener('wheel', this.onWheel)
      el.removeEventListener('touchstart', this.onTouchStart)
      el.removeEventListener('touchmove', this.onTouchMove)
      el.removeEventListener('touchend', this.onTouchEnd)
      el.removeEventListener('touchcancel', this.onTouchEnd)
      this._boundEl = null
    },
    onDragStart(e) {
      this._cacheRect(e)
      const p = this._eventPoint(e)
      this._drag = { x: p.x, y: p.y, moved: false }
    },
    onDragMove(e) {
      if (!this._drag) return
      const p = this._eventPoint(e)
      const dx = p.x - this._drag.x
      const dy = p.y - this._drag.y
      if (!this._drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
      this._drag.moved = true
      this._userMoved = true
      this._drag.x = p.x
      this._drag.y = p.y
      const s = zoomScale(this.cam.zoom)
      this.cam = { ...this.cam, u: this.cam.u - dx / s, v: this.cam.v - dy / s }
      this.renderSchematic()
    },
    onDragEnd() {
      if (this._drag && this._drag.moved) {
        // 拖动结束后的 click 不应选中车辆/站点
        this._suppressClick = true
        setTimeout(() => { this._suppressClick = false }, 120)
      }
      this._drag = null
    },
    onTouchStart(e) {
      this._cacheRect(e)
      if (e.touches && e.touches.length === 2) {
        const a = e.touches[0]
        const b = e.touches[1]
        this._pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        this._drag = null
      } else {
        this.onDragStart(e)
      }
    },
    onTouchMove(e) {
      if (e.cancelable) e.preventDefault()
      if (e.touches && e.touches.length === 2 && this._pinchDist) {
        const a = e.touches[0]
        const b = e.touches[1]
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        if (d > 0) {
          const mid = this._pointOf({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 })
          this.zoomAt(mid.x, mid.y, Math.log2(d / this._pinchDist))
          this._pinchDist = d
        }
        return
      }
      this.onDragMove(e)
    },
    onTouchEnd() {
      this._pinchDist = 0
      this.onDragEnd()
    },
    onWheel(e) {
      if (e.cancelable) e.preventDefault()
      this._cacheRect(e)
      const dy = e.deltaY || 0
      if (!dy) return
      const p = this._eventPoint(e)
      this.zoomAt(p.x, p.y, -dy * 0.0018)
    },
    onBusTap(bus) {
      if (this._suppressClick) return
      this.selectBus(bus)
    },
    onStopTap(s) {
      if (this._suppressClick) return
      uni.showToast({ title: `${s.name}（${DIR_STYLE[s.dir].name}）`, icon: 'none' })
    },
    // 绘制自绘走向图：用相机做 Web Mercator 投影（走向线 + 站点 + 车辆 + 经纬网格）
    renderSchematic() {
      const w = this.canvas.w
      const h = this.canvas.h
      if (!w || !h) return
      // 0) 底图瓦片（随相机平移缩放重算）
      this.renderTiles()
      // 全市态：线网 + 车点 + 自编号；站点与本线车辆全部让位，否则一千多个点压在线路上什么都看不清
      if (this.cityOn) {
        this.renderCityLayer()
        return
      }
      const dirs = this.dirFilter === 2 ? [0, 1] : [this.dirFilter]
      const s = zoomScale(this.cam.zoom)
      const sx = (lng) => (mercX(lng) - this.cam.u) * s + this.projCenter.x
      const sy = (lat) => (mercY(lat) - this.cam.v) * s + this.projCenter.y
      // 双方向同屏时两条线各沿行进右侧偏 3.5px（靠右分居），单方向时不偏移
      const trackOff = dirs.length > 1 ? 3.5 : 0
      // 屏幕坐标下的法向偏移（x 右 y 下，行进右侧 = (-dy, dx)）
      const sideShift = (pts, m) => {
        if (!m || pts.length < 2) return pts
        const n = pts.length
        return pts.map((p, i) => {
          const a = pts[Math.max(0, i - 1)]
          const b = pts[Math.min(n - 1, i + 1)]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.hypot(dx, dy) || 1
          return { x: p.x - (dy / len) * m, y: p.y + (dx / len) * m }
        })
      }
      const ptsOf = (d) => {
        const src = (this.routeByDir[d] && this.routeByDir[d].length > 1)
          ? this.routeByDir[d].map((p) => ({ lat: p.latitude, lng: p.longitude }))
          : (this.stopsByDir[d] || []).map((st) => ({ lat: parseFloat(st.latitude), lng: parseFloat(st.longitude) }))
        const raw = src.filter((p) => !isNaN(p.lat) && !isNaN(p.lng)).map((p) => ({ x: sx(p.lng), y: sy(p.lat) }))
        return sideShift(raw, trackOff)
      }

      // 1) 走向线（轨迹点过多时抽样，避免路径字符串过长拖慢渲染）+ 方向箭头
      const routes = []
      const arrows = []
      dirs.forEach((d) => {
        const pts = ptsOf(d)
        if (pts.length < 2) return
        const step = pts.length > 400 ? Math.ceil(pts.length / 400) : 1
        const sampled = step > 1 ? pts.filter((p, i) => i % step === 0).concat([pts[pts.length - 1]]) : pts
        // 未贴路（计算中/失败）时画细虚线 + 半透明：明确告诉用户这是站间直连估算，不是真实走向
        // 贴路后两个方向靠颜色 + 横向偏移区分，不再用虚线（双轨并排比虚线更好读）
        const snapped = !!(this.routeByDir[d] && this.routeByDir[d].length > 1)
        routes.push({
          dir: d,
          d: smoothPath(sampled),
          color: DIR_STYLE[d].svgStroke,
          dash: snapped ? 'none' : '3 6',
          w: snapped ? 4.5 : 3,
          op: snapped ? 1 : 0.55,
        })
        ;[0.34, 0.67].forEach((f) => {
          const i = Math.min(pts.length - 2, Math.max(0, Math.round(f * (pts.length - 1))))
          const a = pts[i]
          const b = pts[i + 1]
          arrows.push({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
            color: DIR_STYLE[d].svgStroke,
          })
        })
      })
      this.svgRoutes = routes
      this.routeArrows = arrows

      // 2) 车辆标签位置先算：车号在圆点上方且彼此错开，站名避让需要用到最终位置
      const usedBusLabel = []
      const busPts = this.shownBuses.map((b) => {
        const x = sx(b.lng)
        const y = sy(b.lat)
        let ly = y
        for (let k = 0; k < 4; k++) {
          if (!usedBusLabel.some((p) => Math.abs(p.x - x) < 46 && Math.abs(p.ly - ly) < 15)) break
          ly -= 15
        }
        usedBusLabel.push({ x, ly })
        return { x, y, ly }
      })

      // 3) 站点与站名（左右交替 + 纵向避让 + 双方向同名去重 + 避开车辆标签）
      const stops = []
      const labels = []
      const usedR = []
      const usedL = []
      const placedNames = []
      // 窄屏抽稀：整条线在 390px 宽里挤 29 个站名只会全部碰撞丢弃（实测只剩首末站），
      // 改成每隔 stride 个站标一个名，覆盖均匀且能真正显示出来
      const stride = w < 600 ? Math.max(1, Math.ceil(Math.max(...dirs.map((d) => (this.stopsByDir[d] || []).length)) / 10)) : 1
      dirs.forEach((d) => {
        const arr = this.stopsByDir[d] || []
        arr.forEach((st, i) => {
          const lat = parseFloat(st.latitude)
          const lng = parseFloat(st.longitude)
          if (isNaN(lat) || isNaN(lng)) return
          const x = sx(lng)
          const y = sy(lat)
          const terminal = i === 0 || i === arr.length - 1
          stops.push({
            dir: d,
            idx: i,
            name: st.stopName,
            x,
            y,
            terminal,
            color: DIR_STYLE[d].svgStroke,
          })
          // 放太小时不标站名（避免叠成一团）；窄屏因为有 stride 抽稀，可以放宽到能看站序的级别
          const zoomGate = w < 600 ? 10.5 : 13
          if (!this.showStopLabels || !(terminal || this.cam.zoom >= zoomGate)) return
          if (!terminal && stride > 1 && i % stride !== 0) return
          // 上下行同一站点不重复标注
          if (placedNames.some((p) => p.name === st.stopName && Math.abs(p.x - x) < 90 && Math.abs(p.y - y) < 30)) return
          // 靠边时强制把文字放到画布内侧（先定方向，才能算出文字框做碰撞判定）
          let right = i % 2 === 0
          if (x < 110) right = true
          else if (x > w - 110) right = false
          // 与站点圆点（半径 6.5）留出 4px 间隙
          const lx = right ? x + 11 : x - 11
          const sw = textW(st.stopName)
          const nx1 = right ? lx : lx - sw
          const box = { x1: nx1, x2: nx1 + sw, y1: y - 6, y2: y + 6 }
          // 压在车辆圆点上就直接不放（首末站不因此丢弃，交由后面与车号文本框避让）
          const onDot = busPts.some(
            (p) => !(box.x2 <= p.x - 10 || p.x + 10 <= box.x1 || box.y2 <= p.y - 10 || p.y + 10 <= box.y1)
          )
          if (!terminal && onDot) return
          const bucket = right ? usedR : usedL
          // 同一侧纵向太近就挤不下（首末站例外，它们必须显示，后面还会上下微移）
          if (!terminal && bucket.some((py) => Math.abs(py - y) < 17)) return
          bucket.push(y)
          placedNames.push({ name: st.stopName, x, y })
          labels.push({
            dir: d,
            idx: i,
            name: st.stopName,
            terminal,
            anchor: right ? 'start' : 'end',
            lx,
            ly: y,
          })
        })
      })
      this.svgStops = stops
      this.labelStops = labels

      // 4) 车辆（圆点 + 已算好的车号位置）
      this.svgBuses = this.shownBuses.map((b, i) => {
        const p = busPts[i]
        return {
          key: b.dir + '-' + i,
          dir: b.dir,
          label: this.selectedBus === b ? (b.orgId || '') : '',
          x: p.x,
          y: p.y,
          labelY: p.ly,
          // 靠边时调整标签对齐方式，避免车号被画布裁掉
          edge: p.x < 34 ? 'l' : (p.x > w - 34 ? 'r' : ''),
          color: DIR_STYLE[b.dir].bus,
          selected: this.selectedBus === b,
          located: this.locatedBus === b,
          bus: b,
        }
      })

      // 5) 兜底避让：站名文本框与车号、其他站名重叠时让位（首末站上下微移保留，其余直接丢弃）
      const busBoxes = this.svgBuses.map((b) => {
        if (!b.label) return null
        const bw = textW(b.label)
        const x1 = b.edge === 'l' ? b.x : (b.edge === 'r' ? b.x - bw : b.x - bw / 2)
        // .bus-label 已设 line-height:1，-200% 位移后占据 [labelY-22, labelY-11]
        return { x1, x2: x1 + bw, y1: b.labelY - 23, y2: b.labelY - 10 }
      })
      this.labelStops = (() => {
        const out = []
        const taken = []
        const boxOf = (s, ly) => {
          const sw = textW(s.name)
          const x1 = s.anchor === 'start' ? s.lx : s.lx - sw
          return { x1, x2: x1 + sw, y1: ly - 7, y2: ly + 7 }
        }
        const hitAny = (b, list) =>
          list.some((bb) => bb && !(b.x2 <= bb.x1 || bb.x2 <= b.x1 || b.y2 <= bb.y1 || bb.y2 <= b.y1))
        const bad = (b) => hitAny(b, busBoxes) || hitAny(b, taken)
        labels.forEach((s) => {
          if (bad(boxOf(s, s.ly))) {
            if (!s.terminal) return
            for (const dy of [-14, 14, -28, 28, -42, 42, -56]) {
              if (!bad(boxOf(s, s.ly + dy))) {
                s.ly += dy
                break
              }
            }
          }
          taken.push(boxOf(s, s.ly))
          out.push(s)
        })
        return out
      })()

      this.gridLines = this.buildGrid(s, w, h)
    },
    // 经纬网格：间距换算到像素后再取整档，随相机移动。
    // 有底图时不画（底图自带路网背景），免得两层线打架；线路态与全市态共用。
    buildGrid(s, w, h) {
      if (this.showBaseMap) return []
      const uMin = this.cam.u - this.projCenter.x / s
      const uMax = uMin + w / s
      const vMin = this.cam.v - this.projCenter.y / s
      const vMax = vMin + h / s
      const nice = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1]
      const step = nice.find((v) => v >= 110 / s) || 0.1
      const grid = []
      for (let u = Math.ceil(uMin / step) * step; u <= uMax && grid.length < 120; u += step) {
        const x = (u - this.cam.u) * s + this.projCenter.x
        grid.push({ key: 'u' + u.toFixed(6), x1: x, y1: 0, x2: x, y2: h })
      }
      for (let v = Math.ceil(vMin / step) * step; v <= vMax && grid.length < 240; v += step) {
        const y = (v - this.cam.v) * s + this.projCenter.y
        grid.push({ key: 'v' + v.toFixed(6), x1: 0, y1: y, x2: w, y2: y })
      }
      return grid
    },
    // 全市图层（自绘模式）：先铺线网走向，再按视野裁剪→像素网格聚合→速度分档画车点，最后补近景自编号。
    // 站名与本线车辆此时清空（它们属于单条线路的作用域）。
    renderCityLayer() {
      const vp = this._cityViewport()
      const w = vp.w
      const h = vp.h
      const s = zoomScale(this.cam.zoom)
      this.svgRoutes = []
      this.routeArrows = []
      this.svgStops = []
      this.labelStops = []
      this.svgBuses = []
      // 线网在下、车点在上
      this.renderCityNet(s, w, h)
      const items = []
      const pad = 40
      for (const b of this.cityShown) {
        const x = (mercX(b.lng) - this.cam.u) * s + this.projCenter.x
        const y = (mercY(b.lat) - this.cam.v) * s + this.projCenter.y
        if (x < -pad || y < -pad || x > w + pad || y > h + pad) continue
        items.push({ x, y, b })
      }
      const cell = this.cam.zoom >= CITY_CLUSTER_MIN_ZOOM ? 0 : CITY_CELL_SVG
      this.cityDots = clusterPoints(items, cell).map((c, i) => ({
        key: (c.bus ? 'b' : 'g') + i,
        x: c.x,
        y: c.y,
        // 单车点半径 6（与线路态车辆圆点同量级），聚合团 14 以容纳数字标签
        r: c.bus ? 6 : 14,
        n: c.n,
        color: c.bus ? SPEED_BANDS[c.bus.band].color : '#6366F1',
        bus: c.bus || null,
        located: !!c.bus && this.locatedBus === c.bus,
      }))
      this.cityTags = this.buildCityTags(this.cityDots)
      this.gridLines = this.buildGrid(s, w, h)
    },
    // 原生地图的标记点击（单击 / 双击都可，双击就是连点两次）。
    // ⚠ uni-h5 的 markertap 是自定义事件：normalizeCustomEvent 只返回 { type, timeStamp, target, currentTarget, detail }，
    //   参数全在 e.detail 里——直接读 e.markerId 恒为 undefined，会让“点车图标”完全没反应。
    onMarkerTap(e) {
      const detail = (e && e.detail) || {}
      const raw = detail.markerId != null ? detail.markerId : (e && e.markerId)
      const id = Number(raw)
      if (!Number.isFinite(id)) return
      // 全市态：车点 5 万段、聚合团 6 万段（命中信息在 cityNativeMarkers 里顺手记进 _cityHit）
      if (this.cityOn && id >= CITY_DOT_ID) {
        const hit = this._cityHit && this._cityHit.get(id)
        if (!hit) return
        if (hit.bus) this.selectBus(hit.bus)
        else {
          // 聚合团：以团心为中心放大两档，把团展开成单车
          const base = (this._view && this._view.scale) || this.mapScale || 13
          const scale = clampNum(Math.round(base) + 2, 9, 18)
          this._view = { center: { lat: hit.lat, lng: hit.lng }, scale }
          this.mapCenter = { lat: hit.lat, lng: hit.lng }
          this.mapScale = scale
          this.mapKey++
        }
        return
      }
      // 站点标记：id = 5000 + dir*1000 + 序号
      if (id >= 5000 && id < 10000) {
        const dir = Math.floor((id - 5000) / 1000)
        const s = (this.stopsByDir[dir] || [])[ (id - 5000) % 1000 ]
        if (s) uni.showToast({ title: `站点：${s.stopName}（${DIR_STYLE[dir].name}）`, icon: 'none' })
        return
      }
      // 车辆标记：id = (dir+2)*10000 + 序号 → 弹出车辆详情窗
      if (id >= 20000) {
        const dir = Math.floor(id / 10000) - 2
        const bus = (this.busesByDir[dir] || [])[id % 10000]
        if (bus) this.selectBus(bus)
      }
    },
    // 选中车辆：弹出详情窗（示意图车辆点与列表项也走这里）
    selectBus(bus) {
      this.selectedBus = bus
      this.renderSchematic()
    },
    // —— 详情窗：拖动 / 固定 / 关闭 ——
    closeSheet() {
      if (this._suppressSheetClick) return
      this.selectedBus = null
      this.renderSchematic()
    },
    // 固定：锁定当前位置（标题栏不再响应拖动），再点一次解锁
    toggleSheetPin() {
      if (this._suppressSheetClick) return
      this.sheetPinned = !this.sheetPinned
      uni.showToast({ title: this.sheetPinned ? '已固定位置，点 📌 可解锁拖动' : '已解锁，可拖动', icon: 'none' })
    },
    // 指针坐标（客户端坐标系；鼠标与触摸事件都兼容）
    _sheetPoint(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e
      if (!t) return null
      const x = t.clientX != null ? t.clientX : t.x
      const y = t.clientY != null ? t.clientY : t.y
      if (x == null || y == null) return null
      return { x, y }
    },
    // 把窗口限制在视口内（留 6px 边距），免得拖出屏幕后找不回来
    clampSheet(x, y, w, h) {
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 375
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 667
      const pad = 6
      return {
        x: clampNum(x, pad, Math.max(pad, vw - w - pad)),
        y: clampNum(y, pad, Math.max(pad, vh - h - pad)),
      }
    },
    // 嵌入态全屏切换：给根节点挂 .fs（position:fixed 铺满视口，逃出 72vh 宿主），
    // 同时锁住页面滚动；容器尺寸变了要重测画布与 UI 占位
    toggleFullscreen() {
      this.isFullscreen = !this.isFullscreen
      // #ifdef H5
      document.body.style.overflow = this.isFullscreen ? 'hidden' : ''
      // #endif
      this.$nextTick(() => {
        this.syncCanvasSize()
        this.measureUi()
        this.clampSheetPos()
      })
    },
    // 视口尺寸变化后重新收进屏幕
    clampSheetPos() {
      if (!this.sheetPos) return
      const el = typeof document !== 'undefined' ? document.querySelector('.bus-sheet') : null
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
      this.sheetPos = this.clampSheet(this.sheetPos.x, this.sheetPos.y, r ? r.width : 320, r ? r.height : 360)
    },
    // 开始拖动：记住指针相对窗口左上角的偏移，之后按绝对位置移动（窗口不会跳）
    sheetDown(e) {
      if (this.sheetPinned) return
      // 触摸结束后浏览器会补发一个 mousedown，别让它把刚结束的拖动又点亮
      if (e.type === 'mousedown' && Date.now() - (this._lastSheetTouch || 0) < 700) return
      if (e.type === 'touchstart') this._lastSheetTouch = Date.now()
      const el = this._sheetEl || (typeof document !== 'undefined' ? document.querySelector('.bus-sheet') : null)
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
      const p = this._sheetPoint(e)
      if (!rect || !p) return
      this._sheetEl = el
      this._sheetDrag = { ox: p.x - rect.left, oy: p.y - rect.top, w: rect.width, h: rect.height, x0: p.x, y0: p.y, moved: false }
      this.sheetPos = { x: rect.left, y: rect.top }
      this.sheetDragging = true
      // 鼠标拖动时指针很容易离开标题栏，监听挂到 document 上；触摸事件本身会重定向到起始元素
      if (e.type === 'mousedown' && typeof document !== 'undefined') {
        document.addEventListener('mousemove', this.sheetMove)
        document.addEventListener('mouseup', this.sheetUp)
      }
    },
    sheetMove(e) {
      const d = this._sheetDrag
      if (!d || this.sheetPinned) return
      if (e.cancelable) e.preventDefault()
      const p = this._sheetPoint(e)
      if (!p) return
      if (!d.moved && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) < 3) return
      d.moved = true
      this.sheetPos = this.clampSheet(p.x - d.ox, p.y - d.oy, d.w, d.h)
    },
    sheetUp() {
      const d = this._sheetDrag
      this._sheetDrag = null
      this.sheetDragging = false
      // 拖动收尾那一下的 click 不该按到 📌 / ✕
      if (d && d.moved) {
        this._suppressSheetClick = true
        setTimeout(() => { this._suppressSheetClick = false }, 120)
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousemove', this.sheetMove)
        document.removeEventListener('mouseup', this.sheetUp)
      }
    },
    // 原生绑定：uni-app H5 对 view 的 mouse 事件绑定不可靠，标题栏拖动直接用 DOM 监听
    bindSheetDrag() {
      this.unbindSheetDrag()
      if (typeof document === 'undefined') return
      const el = document.querySelector('.bus-sheet')
      const head = el && el.querySelector('.sheet-head')
      if (!el || !head) return
      this._sheetEl = el
      this._sheetHead = head
      head.style.touchAction = 'none'
      head.addEventListener('mousedown', this.sheetDown)
    },
    unbindSheetDrag() {
      if (this._sheetHead) this._sheetHead.removeEventListener('mousedown', this.sheetDown)
      this._sheetHead = null
      this._sheetEl = null
      this._sheetDrag = null
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousemove', this.sheetMove)
        document.removeEventListener('mouseup', this.sheetUp)
      }
    },
    // —— 鼠标悬停车辆图标 → 浮标显示自编号 ——
    // 原生地图没有能挂到 marker 上的 hover 事件，只能自己把经纬度投影成屏幕像素再判距；
    // 两种模式共用同一套 Web Mercator 正投影（原生用 regionchange 记下的中心/缩放，自绘用相机）。
    _hoverHostEl() {
      if (typeof document === 'undefined') return null
      return document.querySelector(this.useMap ? 'uni-map' : '.schematic')
    },
    _projectTo(lat, lng, w, h) {
      if (this.useMap) {
        const v = this._view || {}
        const s = zoomScale(v.scale || this.mapScale || 13)
        const c = v.center || this.mapCenter
        return { x: (mercX(lng) - mercX(c.lng)) * s + w / 2, y: (mercY(lat) - mercY(c.lat)) * s + h / 2 }
      }
      const s = zoomScale(this.cam.zoom)
      return { x: (mercX(lng) - this.cam.u) * s + this.projCenter.x, y: (mercY(lat) - this.cam.v) * s + this.projCenter.y }
    },
    bindHover() {
      this.unbindHover()
      const host = this._hoverHostEl()
      if (!host) return
      this._hoverHost = host
      host.addEventListener('mousemove', this.onHoverMove)
      host.addEventListener('mouseleave', this.onHoverLeave)
    },
    unbindHover() {
      const host = this._hoverHost
      this._hoverHost = null
      this.hoverTip = null
      if (!host) return
      host.removeEventListener('mousemove', this.onHoverMove)
      host.removeEventListener('mouseleave', this.onHoverLeave)
    },
    onHoverLeave() {
      if (this.hoverTip) this.hoverTip = null
    },
    onHoverMove(e) {
      const host = this._hoverHost
      if (!host) return
      // 拖地图时不弹浮标（否则平移路上会一路闪）
      if (this._drag && this._drag.moved) return
      if (this.cityOn) {
        // 全市态命中池换成快照里的车点；点位密，半径收到 14px，免得鼠标一滑就跳到邻车
        const pool = this.cityShown
        if (!pool.length) {
          if (this.hoverTip) this.hoverTip = null
          return
        }
        const r = host.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        let best = 14
        let hit = null
        pool.forEach((b) => {
          const p = this._projectTo(b.lat, b.lng, r.width, r.height)
          const d = Math.hypot(p.x - px, p.y - py)
          if (d < best) { best = d; hit = { bus: b, p } }
        })
        if (!hit) {
          if (this.hoverTip) this.hoverTip = null
          return
        }
        const lift = this.useMap ? 30 : 20
        const page = (typeof document !== 'undefined' && document.querySelector('.lmap-page')) || host
        const pr = page.getBoundingClientRect()
        const tip = {
          x: Math.round(hit.p.x + r.left - pr.left),
          y: Math.round(hit.p.y + r.top - pr.top - lift),
          no: hit.bus.orgId || '',
          // 全市态光有自编号不知道是哪路，补一行线路与方向
          line: `${hit.bus.no} ${hit.bus.dir === 0 ? '上行' : '下行'}`,
        }
        const old = this.hoverTip
        if (old && old.no === tip.no && old.line === tip.line && Math.abs(old.x - tip.x) < 1 && Math.abs(old.y - tip.y) < 1) return
        this.hoverTip = tip
        return
      }
      if (!this.shownBuses.length) {
        if (this.hoverTip) this.hoverTip = null
        return
      }
      const r = host.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      // 命中半径 18px（图标/光晕左右宽约 34px，略带容错好点中）
      let best = 18
      let hit = null
      this.shownBuses.forEach((b) => {
        const p = this._projectTo(b.lat, b.lng, r.width, r.height)
        const d = Math.hypot(p.x - px, p.y - py)
        if (d < best) { best = d; hit = { bus: b, p } }
      })
      if (!hit) {
        if (this.hoverTip) this.hoverTip = null
        return
      }
      // 浮标落在图标上方：原生 marker 图标底边对着坐标点，自绘圆点以坐标点为圆心
      const lift = this.useMap ? 42 : 20
      const page = (typeof document !== 'undefined' && document.querySelector('.lmap-page')) || host
      const pr = page.getBoundingClientRect()
      const tip = {
        x: Math.round(hit.p.x + r.left - pr.left),
        y: Math.round(hit.p.y + r.top - pr.top - lift),
        no: hit.bus.orgId || '',
      }
      const old = this.hoverTip
      if (old && old.no === tip.no && Math.abs(old.x - tip.x) < 1 && Math.abs(old.y - tip.y) < 1) return
      this.hoverTip = tip
    },
    // 定位后的扩散波（只自绘图有；原生地图靠缩放级别自明）
    flashLocated(bus) {
      this.locatedBus = bus
      this.renderSchematic()
      if (this._locTimer) clearTimeout(this._locTimer)
      this._locTimer = setTimeout(() => {
        this.locatedBus = null
        this.renderSchematic()
      }, 1600)
    },
    // 挑一个不被详情浮窗 / 控制卡 / 右侧面板遮住的屏幕点（相对地图容器）
    // 不挑的话“定位”会把车放到窗口正后面，放大了也看不见（桌面端实测就是如此）
    freeSpot(w, h, hr) {
      const boxes = []
      if (typeof document !== 'undefined') {
        const l0 = (hr && hr.left) || 0
        const t0 = (hr && hr.top) || 0
        ;['.bus-sheet', '.ctrl', '.side-col', '.float-win'].forEach((sel) => {
          const el = document.querySelector(sel)
          if (!el) return
          const b = el.getBoundingClientRect()
          boxes.push({ l: b.left - l0, t: b.top - t0, r: b.right - l0, b: b.bottom - t0 })
        })
      }
      const blocked = (x, y) => boxes.some((o) => x > o.l - 30 && x < o.r + 30 && y > o.t - 30 && y < o.b + 30)
      const spots = [
        { x: w / 2, y: h / 2 },
        { x: w / 2, y: h * 0.3 },
        { x: w / 2, y: h * 0.22 },
        { x: w * 0.28, y: h * 0.55 },
        { x: w * 0.72, y: h * 0.55 },
        { x: w / 2, y: h * 0.72 },
      ]
      return spots.find((p) => !blocked(p.x, p.y)) || spots[0]
    },
    // 详情面板内「在地图上定位」：居中 + 放到最大缩放，做到“精确定位到车”
    focusBus(bus) {
      if (!bus) return
      // 原生地图上限一般 18~19；自绘相机上限 18.5（与 fitRoute / zoomAt 的夹取保持一致）
      const ZOOM = this.useMap ? 18 : 18.5
      const host = this._hoverHostEl()
      const hr = host ? host.getBoundingClientRect() : null
      const w = (hr && hr.width) || this.canvas.w
      const h = (hr && hr.height) || this.canvas.h
      // 把车放在可见区域的空处，而不是死板地放正中央（正中往往被详情窗盖住）
      const spot = this.freeSpot(w, h, hr)
      const s = zoomScale(ZOOM)
      const cu = mercX(bus.lng) - (spot.x - w / 2) / s
      const cv = mercY(bus.lat) - (spot.y - h / 2) / s
      const center = { lat: invMercY(cv), lng: invMercX(cu) }
      this.flashLocated(bus)
      if (this.useMap) {
        this.mapCenter = center
        this.mapScale = ZOOM
        // 同步“当前视野”，否则下一次自动刷新会把画面还原到定位前的位置
        this._view = { center, scale: ZOOM }
        this.mapKey++
      } else {
        // 自绘图：相机直接对准，投影中心复位到画布中心
        this._userMoved = true
        this.camInited = true
        this.projCenter = { x: w / 2, y: h / 2 }
        this.cam = { u: cu, v: cv, zoom: ZOOM }
        this.renderSchematic()
      }
      this.onHoverLeave()
    },
    busCompanyText(bus) {
      return orgCompanyOf(bus)
    },
    busStateText(bus) {
      return busStateOf(bus)
    },
    formatGpsTime(t) {
      if (!t || t.length !== 14) return '--'
      return `${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}`
    },
  },
}
</script>

<style scoped>
.lmap-page {
  position: relative;
  width: 100%;
  height: 100%;
  /* 宿主给定高度时铺满宿主（嵌入式 72vh / 独立页满屏），不再写死 100vh 以免溢出宿主 */
  min-height: 100%;
}
/* 嵌入态全屏：fixed 逃出 72vh 宿主铺满视口（宿主链上无 transform/filter 祖先，可安全逃逸） */
.lmap-page.fs {
  position: fixed;
  inset: 0;
  z-index: 1200;
  border-radius: 0;
}
/* 全屏切换按钮（仅嵌入态渲染）：右下角玻璃小胶囊，高于面板(20)低于详情窗(30) */
.fs-btn {
  position: absolute;
  right: 20rpx;
  bottom: 20rpx;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  color: #e2e8f0;
  background: rgba(10, 14, 24, 0.72);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.35);
  cursor: pointer;
}
.fs-btn:active {
  transform: scale(0.96);
}
.fs-ico {
  font-size: 26rpx;
  line-height: 1;
}
.fs-txt {
  font-size: 24rpx;
  line-height: 1;
}
.map {
  width: 100%;
  height: 100%;
}
/* 自绘走向图模式（无地图 Key，全屏 SVG 投影） */
.schematic {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background:
    radial-gradient(60% 45% at 72% 18%, rgba(99, 102, 241, 0.18), transparent 70%),
    radial-gradient(55% 45% at 18% 82%, rgba(6, 182, 212, 0.14), transparent 70%),
    #070b18;
  cursor: grab;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.schematic:active {
  cursor: grabbing;
}
/* 底图瓦片层（高德标准图，免 Key）：在 SVG 与站名层之下 */
.tile-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  /* 底图只做背景：降饱和、压亮度，让走向线/站名/车辆成为视觉主体 */
  filter: saturate(0.55) brightness(0.72) contrast(0.92);
  /* 瓦片未到位时先给一个地图纸色：放大到 z18 时单张瓦片很大，缺失会是一个巨大的黑块 */
  background: #dfe3e8;
}
.tile {
  position: absolute;
  display: block;
}
.tile-shade {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background: rgba(7, 11, 24, 0.40);
}
.route-svg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: block;
}
/* 站名 / 车号叠加层：SVG 的 <text> 会被 uni-app 编译为 uni-text 而无法渲染，改用 HTML 定位 */
.label-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}
.stop-label {
  position: absolute;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1;
  color: rgba(226, 232, 255, 0.7);
  transform: translate(0, -50%);
  text-shadow: 0 0 3px #070b18, 0 0 6px #070b18, 0 0 10px #070b18;
}
/* uni-text 自带 white-space，需显式覆盖否则站名会折行 */
.stop-label uni-text,
.stop-label text,
.bus-label uni-text,
.bus-label text {
  white-space: nowrap;
}
.stop-label.left {
  transform: translate(-100%, -50%);
}
.stop-label.terminal {
  color: #f8fafc;
  font-weight: 700;
}
.bus-label {
  position: absolute;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  transform: translate(-50%, -200%);
  text-shadow: 0 0 3px #070b18, 0 0 6px #070b18, 0 0 10px #070b18;
}
.bus-label.edge-l {
  transform: translate(0, -200%);
}
.bus-label.edge-r {
  transform: translate(-100%, -200%);
}
/* 鼠标悬停车辆图标的浮标：只显示自编号数字，离开即消失（不常驻、不拦截鼠标） */
.bus-hover {
  position: absolute;
  z-index: 26;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(11, 16, 32, 0.92);
  border: 2rpx solid rgba(148, 163, 255, 0.5);
  box-shadow: 0 10rpx 28rpx rgba(0, 0, 0, 0.55);
  white-space: nowrap;
  /* 锚点在图标上方：水平居中 + 整个浮标上移到底边 */
  transform: translate(-50%, -100%);
  pointer-events: none;
}
.bh-no {
  font-size: 24rpx;
  font-weight: 800;
  line-height: 1;
  color: #a5f3fc;
  letter-spacing: 1rpx;
}
/* 定位成功后的扩散环（自绘走向图） */
.bus-pulse {
  transform-box: fill-box;
  transform-origin: center;
  animation: busPulse 1.2s ease-out 1;
}
@keyframes busPulse {
  0% { transform: scale(1); opacity: 0.95; }
  100% { transform: scale(3.4); opacity: 0; }
}
.canvas-empty {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  pointer-events: none;
}
.empty-big {
  font-size: 72rpx;
  opacity: 0.5;
}
.empty-txt {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.45);
}
.schematic-legend {
  position: absolute;
  left: 24rpx;
  bottom: 24rpx;
  display: flex;
  align-items: center;
  gap: 28rpx;
  padding: 10rpx 24rpx;
  border-radius: 999rpx;
  background: rgba(11, 16, 32, 0.62);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.68);
  z-index: 9;
}
.legend-item {
  display: flex;
  align-items: center;
}
.dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  margin-right: 8rpx;
  display: inline-block;
}
/* 站点：空心环；与自绘走向图里的站点圆点一致 */
.dot.stop {
  background: #0b1020;
  border: 3rpx solid #cbd5e1;
  box-sizing: border-box;
}
/* 走向线色卡：与 DIR_STYLE.svgStroke 一一对应（上行青蓝 / 下行玫红） */
.ln {
  width: 26rpx;
  height: 6rpx;
  border-radius: 3rpx;
  margin-right: 8rpx;
  display: inline-block;
}
.ln.up { background: #22d3ee; }
.ln.down { background: #fb7185; }
/* 窄屏：底部让位给车辆横栏，隐藏图例（颜色说明已写进控制卡提示） */
@media (max-width: 720px) {
  .schematic-legend {
    display: none;
  }
}
/* 左上角控制卡：整块是一张玻璃卡片，内部分 搜索 / 主操作 / 视图 / 方向 四个区 */
.ctrl {
  position: absolute;
  top: 24rpx;
  left: 24rpx;
  width: 720rpx;
  max-width: calc(100vw - 48rpx);
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 12rpx;
  box-sizing: border-box;
  background: rgba(11, 16, 32, 0.82);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 26rpx;
  box-shadow: 0 18rpx 48rpx rgba(0, 0, 0, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.1);
  z-index: 10;
}
/* 组间分割线：比单纯拉开间距更能表达“这里是不同的组” */
.ctrl-div {
  height: 2rpx;
  margin: 0 8rpx;
  background: rgba(255, 255, 255, 0.09);
}
/* 搜索行：卡片内的一条凹槽，不再是自带阴影的独立胶囊 */
.ctrl-search {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 6rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 18rpx;
}
.ctrl-icon {
  flex-shrink: 0;
  font-size: 26rpx;
  opacity: 0.75;
}
/* 自定义导航后的返回按钮 */
.ctrl-back {
  flex-shrink: 0;
  width: 52rpx;
  height: 52rpx;
  line-height: 46rpx;
  text-align: center;
  border-radius: 14rpx;
  font-size: 36rpx;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.07);
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.ctrl-back:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
}
.ctrl-input {
  flex: 1;
  min-width: 0;
  height: 52rpx;
  font-size: 26rpx;
  color: #fff;
  background: transparent;
  border: none;
}
.ctrl-ph {
  color: rgba(255, 255, 255, 0.38);
}
.ctrl-go {
  flex-shrink: 0;
  height: 52rpx;
  line-height: 52rpx;
  padding: 0 26rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border-radius: 14rpx;
  cursor: pointer;
  transition: filter 0.18s;
}
.ctrl-go:active {
  filter: brightness(1.12);
}
/* 方向分段条：卡片底部一块凹槽，三个 tab 与线路信息同排 */
.ctrl-dir {
  display: flex;
  align-items: center;
  /* 单行：营运公司徽标必须紧跟在“337 路”后面，一旦允许换行就会跑到第二排、看着像错位 */
  flex-wrap: nowrap;
  gap: 6rpx;
  padding: 6rpx;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 18rpx;
}
.dir-tab {
  /* 固定行高 + 双轴 flex 居中：只用 padding 撑高时中文基线会偏，且选中加粗后文字会上下跳 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 52rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  font-size: 24rpx;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.68);
  border-radius: 14rpx;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.dir-tab:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.dir-tab.active {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  font-weight: 700;
}
/* 上/下行选中态直接用方向色，与地图走向线同色 */
.dir-tab.up.active {
  color: #062a33;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
  box-shadow: 0 6rpx 18rpx rgba(6, 182, 212, 0.35);
}
.dir-tab.up.active:hover {
  color: #062a33;
}
.dir-tab.down.active {
  color: #fff;
  background: linear-gradient(135deg, #fda4af, #e11d48);
  box-shadow: 0 6rpx 18rpx rgba(225, 29, 72, 0.35);
}
/* 方向行内的“循环切换”小键：紧贴三个 tab 右侧，颜色随当前视角（上行青 / 下行玫红 / 中性）。
   它本质上就是“切方向”，放在方向行里才有归属感；挂在一键查询旁边时像个多余的旁路按钮。 */
.dir-swap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
  box-sizing: border-box;
  flex: 0 0 auto;
  font-size: 26rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.07);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  border-radius: 12rpx;
  cursor: pointer;
  transition: color 0.18s, background 0.18s, border-color 0.18s, transform 0.12s;
}
.dir-swap:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
}
.dir-swap:active {
  transform: scale(0.94);
}
.dir-swap.d0 {
  color: #67e8f9;
  background: rgba(34, 211, 238, 0.16);
  border-color: rgba(34, 211, 238, 0.42);
}
.dir-swap.d1 {
  color: #fda4af;
  background: rgba(244, 63, 94, 0.16);
  border-color: rgba(244, 63, 94, 0.42);
}
/* 线路号徽章：靠右，与左侧三个方向 tab 用留白分开；胶囊描边 + 靛蓝点缀 */
.dir-cur {
  display: inline-flex;
  align-items: center;
  height: 52rpx;
  margin-left: auto;
  padding: 0 18rpx;
  border-radius: 999rpx;
  background: rgba(129, 140, 248, 0.14);
  border: 2rpx solid rgba(129, 140, 248, 0.38);
  white-space: nowrap;
  flex: 0 0 auto;
}
/* 无线路时的弱化态 */
.dir-cur.none {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.12);
}
.dc-no {
  font-size: 28rpx;
  font-weight: 800;
  line-height: 1;
  color: #c7d2fe;
  font-variant-numeric: tabular-nums;
}
.dc-unit {
  margin-left: 5rpx;
  font-size: 20rpx;
  line-height: 1;
  color: rgba(199, 210, 254, 0.65);
}
/* 营运公司徽标：紧跟线路号同一行（不换行）；地方不够时只把公司名省成省略号 */
.ctrl-org {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  flex: 0 1 auto;
  min-width: 0;
}
.org-tag {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  background: rgba(251, 191, 36, 0.12);
  border: 2rpx solid rgba(251, 191, 36, 0.35);
  border-radius: 999rpx;
  padding: 2rpx 16rpx 2rpx 2rpx;
  white-space: nowrap;
}
.org-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  font-size: 26rpx;
  font-weight: 800;
  color: #1a1205;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  box-shadow: 0 4rpx 12rpx rgba(251, 191, 36, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.4);
  margin-right: 12rpx;
  flex-shrink: 0;
}
.org-name {
  font-size: 20rpx;
  line-height: 1;
  color: #fcd34d;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 右侧栏：一张列容器把「实时车辆」与「发车时刻表」两张独立卡片上下排好。
   高度交给内容（不写 bottom），否则卡下方的空白条会盖住地图、吃掉拖拽手势 */
.side-col {
  position: absolute;
  top: 24rpx;
  right: 24rpx;
  width: 560rpx;
  max-height: calc(100vh - 48rpx);
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  /* 高于刷新下拉遮罩（19），低于车辆详情窗（30） */
  z-index: 20;
}
/* 实时车辆面板（毛玻璃，右侧栏的第一块）
   不写 overflow: hidden —— 刷新间隔下拉是绝对定位挂在卡内的，一剪裁就被卡底截断；
   高度由 max-height 顶住，列内溢出全部交给 .bus-list 自己滚 */
.panel {
  position: relative;
  flex: 0 1 auto;
  min-height: 0;
  max-height: 52vh;
  display: flex;
  flex-direction: column;
  background: rgba(11, 16, 32, 0.72);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 32rpx;
  padding: 28rpx;
  box-sizing: border-box;
  box-shadow: 0 16rpx 48rpx rgba(0, 0, 0, 0.4);
}
/* 窄屏（手机）整列回落为底部横栏：时刻表卡仍在车辆面板下方，两块一起贴底 */
@media (max-width: 720px) {
  .side-col {
    top: auto;
    left: 20rpx;
    right: 20rpx;
    bottom: 20rpx;
    width: auto;
    max-height: 62vh;
  }
}
.panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}
/* 折叠态：只收车辆列表，高度自然收缩 */
.panel.collapsed .panel-header {
  margin-bottom: 0;
}
/* 刷新行：标题栏下方的独立一行，按钮宽度不被标题挤压而竖排换行 */
.panel-tools {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-bottom: 18rpx;
}
.panel.collapsed .panel-tools {
  margin-bottom: 0;
}
.pt-hint {
  flex: 1;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.42);
  text-align: right;
  white-space: nowrap;
}
.collapse-btn {
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 30rpx;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border: 2rpx solid rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: transform 0.25s, background 0.2s;
}
.collapse-btn:hover {
  background: rgba(129, 140, 248, 0.3);
}
.collapse-btn.folded {
  transform: rotate(-90deg);
}
.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 发车时刻表：独立一张卡挂在车辆面板下方（与 .panel 同款玻璃卡壳与字号），
   卡壳在这里、标题行与列表在 LinePlan 里，高度超额时由列表自己滚 */
.plan-side {
  flex: 0 1 auto;
  min-height: 0;
  /* 上下行两组同屏 + 动辄几十班，给到 46vh；再长由列表自己滚 */
  max-height: 46vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: rgba(11, 16, 32, 0.72);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 32rpx;
  padding: 28rpx;
  box-shadow: 0 16rpx 48rpx rgba(0, 0, 0, 0.4);
}
/* 车辆卡折起来时，把腾出的高度整块让给时刻卡（同列相邻兄弟，纯 CSS 就能接上） */
.panel.collapsed + .plan-side {
  max-height: 66vh;
}
.panel-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #fff;
}
/* 刷新控件：左半 ↻ 立即刷一次，右半显示当前间隔并可展开设置（手动 / 15 / 20 / 30 秒） */
.refresh-wrap {
  position: relative;
  flex-shrink: 0;
}
.refresh-pill {
  display: flex;
  align-items: stretch;
  border-radius: 999rpx;
  overflow: hidden;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  box-shadow: 0 8rpx 20rpx rgba(6, 182, 212, 0.35);
}
/* 自动刷新进行中：外圈加一道青色光环，一眼看出“正在自动跑” */
.refresh-pill.auto {
  box-shadow: 0 0 0 3rpx rgba(103, 232, 249, 0.55), 0 8rpx 20rpx rgba(6, 182, 212, 0.35);
}
.refresh-pill.busy .rp-refresh {
  opacity: 0.55;
}
.rp-refresh {
  display: flex;
  align-items: center;
  padding: 10rpx 16rpx 10rpx 22rpx;
  cursor: pointer;
}
.rp-ico {
  font-size: 26rpx;
  line-height: 1;
  color: #fff;
}
.rp-ico.spin {
  animation: rp-spin 0.9s linear infinite;
}
@keyframes rp-spin {
  to {
    transform: rotate(360deg);
  }
}
.rp-split {
  width: 2rpx;
  margin: 12rpx 0;
  background: rgba(255, 255, 255, 0.38);
}
.rp-mode {
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 10rpx 20rpx 10rpx 16rpx;
  cursor: pointer;
}
.rp-txt {
  font-size: 24rpx;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.rp-caret {
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.88);
  transition: transform 0.2s;
}
.rp-caret.open {
  transform: rotate(180deg);
}
/* 间隔下拉：从按钮左缘向下展开（按钮右侧还有提示文字，右对齐会溢出到面板外） */
.refresh-menu {
  position: absolute;
  top: calc(100% + 14rpx);
  left: 0;
  z-index: 3;
  width: 300rpx;
  padding: 10rpx;
  background: rgba(17, 24, 44, 0.96);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 22rpx;
  box-shadow: 0 18rpx 44rpx rgba(0, 0, 0, 0.5);
}
.rm-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx;
  border-radius: 16rpx;
  cursor: pointer;
}
.rm-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.rm-item.on {
  background: rgba(6, 182, 212, 0.22);
}
.rm-label {
  font-size: 24rpx;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
}
.rm-tip {
  flex: 1;
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.42);
  text-align: right;
  white-space: nowrap;
}
.rm-check {
  font-size: 22rpx;
  color: #67e8f9;
}
/* 下拉的“点外部关闭”透明遮罩：面板带 backdrop-filter 会形成包含块，遮罩只能放在面板外层 */
.rm-mask {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 19;
}
/* 窄屏（手机）面板贴在屏幕底部：下拉改为向上展开，否则会被视口底边裁掉 */
@media (max-width: 720px) {
  .refresh-menu {
    top: auto;
    bottom: calc(100% + 14rpx);
  }
}
.bus-list {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  /* 自己当滚动容器（与 LinePlan 的 .plan-body 同一套路）：
     overscroll-behavior: contain 防止滚到尽头后惯性带动外层地图页 */
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.26) transparent;
}
.bus-list::-webkit-scrollbar {
  width: 8rpx;
}
.bus-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.26);
  border-radius: 999rpx;
}
.bus-list::-webkit-scrollbar-track {
  background: transparent;
}
/* 窄屏（手机）：整列只有 62vh，两张卡对半分，各自滚各自 */
@media (max-width: 720px) {
  .panel.collapsed {
    max-height: none;
  }
  .panel {
    max-height: 34vh;
  }
  .plan-side {
    max-height: 28vh;
  }
}
.bus-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 2rpx solid rgba(255, 255, 255, 0.08);
  padding: 22rpx 0;
}
.bus-left {
  display: flex;
  flex-direction: column;
}
.bus-org {
  font-size: 34rpx;
  font-weight: 800;
  color: #a5b4fc;
  font-variant-numeric: tabular-nums;
}
.bus-hash {
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 4rpx;
}
.bus-right {
  font-size: 24rpx;
  text-align: right;
}
.bus-speed {
  color: #67e8f9;
  font-variant-numeric: tabular-nums;
}
.bus-time {
  margin-top: 6rpx;
  color: rgba(255, 255, 255, 0.55);
  font-variant-numeric: tabular-nums;
}
.empty {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 26rpx;
  padding: 40rpx 0;
}
/* 视图工具行按钮：次操作（浅底）统一高度与圆角 */
.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 60rpx;
  padding: 0 22rpx;
  box-sizing: border-box;
  font-size: 22rpx;
  line-height: 1;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.07);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 14rpx;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, transform 0.12s;
}
.tool-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.2);
}
.tool-btn:active {
  transform: scale(0.97);
}
.tool-btn.busy {
  opacity: 0.65;
  pointer-events: none;
}
/* 视图工具行（挂在方向行下方）：方形缩放键 + 三个标签键，高度统一 56rpx */
.ctrl-view {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
}
.tool-btn.sq {
  flex: 0 0 auto;
  width: 56rpx;
  height: 56rpx;
  padding: 0;
  font-size: 26rpx;
}
.tool-btn.sm {
  flex: 0 0 auto;
  height: 56rpx;
  padding: 0 20rpx;
  font-size: 21rpx;
}
/* 已开启（站名 / 底图）：统一用靛蓝——青蓝已被征用为上行色，不能再当普通开关色用 */
.tool-btn.on {
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.22);
  border-color: rgba(129, 140, 248, 0.55);
}
.tool-btn.on:hover {
  background: rgba(99, 102, 241, 0.32);
}
/* 走向尚未贴路（计算中/失败）的提示，避免把站间直连当成真实走向 */
.view-alert {
  align-self: flex-start;
  font-size: 20rpx;
  line-height: 1.4;
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
  border: 2rpx solid rgba(251, 191, 36, 0.32);
  border-radius: 12rpx;
  padding: 8rpx 16rpx;
}
/* 车辆列表项的方向徽标（上行 / 下行，宽度随文字自适应） */
.bus-dir {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34rpx;
  padding: 0 10rpx;
  border-radius: 8rpx;
  font-size: 20rpx;
  font-weight: 800;
  margin-left: 12rpx;
  vertical-align: middle;
}
.bus-dir.d0 {
  color: #67e8f9;
  background: rgba(6, 182, 212, 0.18);
  border: 2rpx solid rgba(34, 211, 238, 0.45);
}
.bus-dir.d1 {
  color: #fda4af;
  background: rgba(225, 29, 72, 0.18);
  border: 2rpx solid rgba(251, 113, 133, 0.45);
}
/* 车辆详情窗：可拖动浮窗（默认居中贴底；拖动过后改用 left/top 绝对定位） */
.bus-sheet {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 160rpx;
  width: 640rpx;
  max-width: calc(100vw - 40rpx);
  z-index: 30;
  background: rgba(11, 16, 32, 0.86);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 32rpx;
  padding: 0 32rpx 24rpx;
  box-sizing: border-box;
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.18);
  /* 位置由 JS 直接给 left/top：不能加 transition，否则拖动跟手有延迟 */
}
/* 标题栏就是拖动手柄：按住任意空白处即可移动窗口 */
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 22rpx 0 18rpx;
  margin-bottom: 4rpx;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.1);
  cursor: move;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
/* 拖动中：提升阴影，视觉上“拿起来了” */
.bus-sheet.dragging {
  box-shadow: 0 32rpx 84rpx rgba(0, 0, 0, 0.62), 0 0 0 2rpx rgba(103, 232, 249, 0.35);
}
/* 已固定：标题栏不可拖，边框变成紫色提示“锁定中” */
.bus-sheet.pinned {
  border-color: rgba(129, 140, 248, 0.55);
}
.bus-sheet.pinned .sheet-head {
  cursor: default;
}
.sheet-title {
  display: flex;
  align-items: center;
  gap: 14rpx;
  flex: 1;
  min-width: 0;
}
/* 拖动把柄：一个竖排点阵，暗示“这里可以拖” */
.sheet-grip {
  font-size: 24rpx;
  line-height: 1;
  letter-spacing: -2rpx;
  color: rgba(255, 255, 255, 0.3);
}
.sheet-actions {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}
.sheet-pin,
.sheet-close {
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
.sheet-pin:active,
.sheet-close:active {
  transform: scale(0.92);
}
.sheet-pin.on {
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.3);
  border-color: rgba(129, 140, 248, 0.65);
}
.sheet-line {
  font-size: 36rpx;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
}
.sheet-dir {
  font-size: 22rpx;
  font-weight: 700;
  border-radius: 999rpx;
  padding: 4rpx 20rpx;
}
.sheet-dir.d0 {
  color: #a5f3fc;
  background: rgba(6, 182, 212, 0.26);
  border: 2rpx solid rgba(34, 211, 238, 0.5);
}
.sheet-dir.d1 {
  color: #ffe4e6;
  background: rgba(225, 29, 72, 0.26);
  border: 2rpx solid rgba(251, 113, 133, 0.5);
}
.sheet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.06);
}
.sk {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.55);
}
.sv {
  font-size: 28rpx;
  font-weight: 700;
  color: #eef1ff;
  font-variant-numeric: tabular-nums;
  text-align: right;
  margin-left: 20rpx;
}
.sheet-btns {
  display: flex;
  gap: 20rpx;
  margin-top: 24rpx;
}
.sheet-btn {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 999rpx;
  padding: 18rpx 0;
  cursor: pointer;
}
.sheet-btn:active {
  transform: scale(0.97);
}
.sheet-btn.primary {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border: none;
}
/* 全市详情窗的“打开这条线路”：主行动用靛蓝青渐变（与定位键的次操作拉开） */
.sheet-btn.go {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border: none;
}
/* —— 全市实时分布 —— */
/* 统计行：卡片内的一行小字，不自带背景/描边（控制卡是“整卡包裹”，子块再套壳就退回碎片感） */
.ctrl-city {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 2rpx 10rpx 0;
}
/* 指标组：数字重、标签轻，靠字号与透明度分层；格子之间一条极淡竖线断开，不各自套背景 */
.cc-figs {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  row-gap: 6rpx;
}
.cc-fig {
  display: flex;
  align-items: baseline;
  padding: 0 16rpx;
}
.cc-fig:first-child {
  padding-left: 4rpx;
}
.cc-fig + .cc-fig {
  border-left: 2rpx solid rgba(255, 255, 255, 0.09);
}
.f-num {
  font-size: 36rpx;
  font-weight: 800;
  line-height: 1.1;
  color: #fff;
  letter-spacing: -0.6rpx;
  font-variant-numeric: tabular-nums;
}
/* 分母（已完成/总方向）：同一个数字的后半段，压小压淡到不抢主体 */
.f-sub {
  font-size: 20rpx;
  font-weight: 600;
  line-height: 1;
  color: rgba(255, 255, 255, 0.36);
  font-variant-numeric: tabular-nums;
}
.f-lab {
  margin-left: 8rpx;
  font-size: 19rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
}
/* 已筛选徽标：琥珀色表示“现在看到的是子集”，✕ 就在它里面，不必去按钮行找 */
.cc-chip {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  margin-left: 12rpx;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  background: rgba(245, 158, 11, 0.14);
  border: 2rpx solid rgba(251, 191, 36, 0.4);
}
.chip-txt {
  font-size: 19rpx;
  font-weight: 700;
  line-height: 1.3;
  color: #fcd34d;
  white-space: nowrap;
}
.chip-x {
  font-size: 20rpx;
  line-height: 1.3;
  color: rgba(252, 211, 77, 0.7);
  cursor: pointer;
}
/* 元信息：时间戳 + 线网规模，整行小字且允许自然换行（旧版挂在按钮行右侧会撑出卡片） */
.cc-meta {
  display: flex;
  flex-wrap: wrap;
  padding: 0 4rpx;
}
.cm-item {
  font-size: 19rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.44);
}
/* 快照过期 / 本轮中止：单独一行琥珀色，与上面的灰色元信息拉开优先级 */
.cc-warn {
  padding: 0 4rpx;
  font-size: 19rpx;
  line-height: 1.5;
  color: #fbbf24;
}
/* 扫描进度条：扫描中才出现，走满后由统计文本接手 */
.cc-bar {
  height: 6rpx;
  border-radius: 3rpx;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
}
.cc-bar-in {
  height: 100%;
  border-radius: 3rpx;
  background: linear-gradient(90deg, #6366f1, #22d3ee);
  transition: width 0.25s ease-out;
}
/* 筛选 / 查车行：两个输入框 + 三个次操作键，窄屏允许换行 */
.ctrl-city-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
  padding: 0 4rpx 2rpx;
}
.cc-input {
  flex: 1 1 180rpx;
  min-width: 0;
  height: 56rpx;
  padding: 0 16rpx;
  box-sizing: border-box;
  font-size: 22rpx;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  border-radius: 14rpx;
}
.cc-ph {
  color: rgba(255, 255, 255, 0.34);
}
/* 与视图工具行的 .tool-btn.sm 同尺寸，保持卡片内动作键一致 */
.cc-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 56rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  font-size: 21rpx;
  line-height: 1;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.07);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 14rpx;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, transform 0.12s;
}
.cc-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.2);
}
.cc-btn:active {
  transform: scale(0.97);
}
.cc-btn.ghost:hover {
  background: rgba(99, 102, 241, 0.22);
}
/* 自动跟随已开启：用靛蓝而不是上行的青，避免与方向色抢语义 */
.cc-btn.on {
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.22);
  border-color: rgba(129, 140, 248, 0.55);
}
/* 车速图例：贴左下角，与线路态的走向图例互斥（同样进 fitRect 的可绘制区计算） */
.city-legend {
  position: absolute;
  left: 24rpx;
  bottom: 24rpx;
  z-index: 9;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 14rpx 20rpx;
  border-radius: 20rpx;
  background: rgba(11, 16, 32, 0.68);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.7);
}
.cl-head {
  font-size: 20rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.5);
}
.cl-item {
  display: flex;
  align-items: center;
}
.cl-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  margin-right: 10rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.85);
  box-sizing: border-box;
  display: inline-block;
}
/* 线网走向色卡：与 DIR_STYLE.svgStroke 同色（青蓝上行 / 玫红下行） */
.cl-line {
  width: 22rpx;
  height: 4rpx;
  border-radius: 2rpx;
  margin-right: 10rpx;
  display: inline-block;
}
.cl-line.up { background: #22d3ee; }
.cl-line.down { background: #fb7185; }
.cl-tip {
  margin-top: 4rpx;
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.4);
}
/* 聚合团里的车辆数（自绘模式的 HTML 文字层，与 stop-label 同一坐标系） */
.city-count {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  font-size: 20rpx;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.75);
}
/* 全市近景的自编号标签：深色贴片 + 车速档文字色（与车点同一套语义）；
   位置以标签中心为锚，与 buildCityTags 里的碰撞盒（y±6px）一致 */
.city-tag {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  font-size: 18rpx;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  background: rgba(11, 16, 32, 0.74);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  font-variant-numeric: tabular-nums;
}
/* 当前详情窗里那辆车的自编号加重，避免在几十个标签里找不到 */
.city-tag.sel {
  background: rgba(99, 102, 241, 0.9);
  border-color: rgba(255, 255, 255, 0.85);
  color: #fff !important;
}
.city-tag uni-text,
.city-tag text {
  white-space: nowrap;
}
/* 悬停浮标第二行：所属线路（全市态才有） */
.bh-line {
  margin-left: 12rpx;
  font-size: 20rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
}
/* 窄屏：图例收到两列并降低字体，免得占掉半个画面 */
@media (max-width: 720px) {
  .city-legend {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 6rpx 18rpx;
    max-width: calc(100vw - 48rpx);
  }
  .cl-tip {
    display: none;
  }
}
</style>