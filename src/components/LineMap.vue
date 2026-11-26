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
    <view v-else class="schematic" :class="{ 'has-tiles': showBaseMap, 'sim-board': simSignboard }">
      <!-- 仿真站牌模式：线路走向改用公交站牌风格（不渲染地理走向 / 车辆点）；
           全市视图不是单线路、无 lineNo 时回退原画布 -->
      <Signboard v-if="simSignboard && !cityOn && lineNo" :line="signboardLine" :groups="signboardGroups" />
      <template v-else>
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
        <!-- 行进方向箭头：实心三角 + 白边，双方向同屏时靠色相+朝向直观区分 -->
        <g v-for="(a, i) in routeArrows" :key="'a' + i" :transform="`translate(${a.x},${a.y}) rotate(${a.deg})`">
          <path d="M-6,-5 L6,0 L-6,5 Z" fill="#fff" :stroke="a.color" stroke-width="1.8" stroke-linejoin="round" />
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
          <!-- 定位成功后的扩散环：告诉用户"就是这个点" -->
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
          :stroke-dasharray="r.dash || 'none'"
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
          :class="{ left: s.anchor === 'end', terminal: s.terminal, 'end-first': s.endKind === 'first', 'end-last': s.endKind === 'last' }"
          :style="{ left: s.lx + 'px', top: s.ly + 'px' }"
          @click="onStopLabelTap(s)"
        >
          <text v-if="s.endTag" class="lb-end">{{ s.endTag }}·</text><text>{{ s.name }}</text>
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
      <!-- 空态提示（不拦截手势）：区分「仍在加载」「查无此线（已加载完但无数据）」「未输入」 -->
      <view class="canvas-empty" v-if="!cityOn && !svgStops.length && !svgBuses.length">
        <text class="empty-big">{{ lineNo && stopsLoaded ? '🔍' : '🚌' }}</text>
        <text class="empty-txt">{{ !lineNo ? '输入线路号查询，即可绘制走向与在运车辆' : (stopsLoaded ? '未查询到「' + lineNo + '」路的线路走向，请检查线路号' : '正在加载线路走向…') }}</text>
      </view>
      <view class="canvas-empty" v-else-if="cityOn && !cityBusy && !cityDots.length">
        <text class="empty-big">🌐</text>
        <text class="empty-txt">{{ cityFilterNo ? '筛选「' + cityFilterNo + '」没有匹配的车辆' : '快照里没有车辆（可能已收班，点 ↻ 重扫试试）' }}</text>
      </view>
      <!-- 图例（线路态：上下行走向；全市态换成下面的车速 + 线网图例） -->
      <view class="schematic-legend" v-if="!cityOn">
        <!-- 环形线没有上下行：图例只留一个「环形走向」 -->
        <template v-if="isLoop">
          <text class="legend-item"><text class="ln loop"></text>环形走向</text>
        </template>
        <template v-else>
          <text class="legend-item"><text class="ln up"></text>上行走向</text>
          <text class="legend-item"><text class="ln down"></text>下行走向</text>
        </template>
        <text class="legend-item"><text class="dot stop"></text>站点 / 车辆</text>
      </view>
      </template>
    </view>

    <!-- 鼠标悬停车辆图标的浮标：始终显示「线路号 · 自编号 · 营运方向」完整格式，
         与地图标签文本格式一致；鼠标离开即消失（不常驻遮挡）；触屏无 hover，单击车图标直接看详情浮窗 -->
    <view class="bus-hover" v-if="hoverTip" :style="{ left: hoverTip.x + 'px', top: hoverTip.y + 'px' }">
      <text class="bh-no">{{ hoverTip.no || '…' }}</text>
      <text class="bh-line" v-if="hoverTip.line">{{ hoverTip.line }}</text>
    </view>

    <!-- 左上角控制卡：搜索 + 线路信息一体化设计，全市态切换时整体展开为统计区 -->
    <view class="ctrl">
      <!-- ◎ 宿主注入的首块（首页地图视图：视图分段 + 线路搜索联想）。
           顶栏卡不再浮在地图外面，而是并入这张控制卡，与方向行 / 视图工具行共用一个卡壳 -->
      <slot name="top"></slot>
      <view class="ctrl-div" v-if="hasTopSlot && !embedded"></view>

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

      <!-- 走向提示：线路态计算中/失败时才显示，不占无效位置 -->
      <view class="view-alert" v-if="!cityOn && routeAlert">{{ routeAlert }}</view>

      <!-- 全市公交区：指标区（数字重 / 标签轻）+ 次操作键行。
           线路号与自编号通查不在这里：顶栏搜索是全站唯一查询入口，全市态下查询=就地
           筛选线路 / 定位车辆（已筛选芯片可清除/打开线路）；卡片加高是安全的（fitRect 读实测 bottom） -->
      <block v-if="cityOn">
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
            <!-- 已筛选某条线：芯片整体可点 = 正式打开这条线路；✕ 才是看回全市 -->
            <view class="cc-chip" v-if="cityFilterNo" :title="'只看 ' + cityFilterNo + ' 路 · 点卡片打开线路，✕ 看回全市'" @click="openFilteredLine">
              <text class="chip-txt">已筛选 {{ cityFilterNo }}</text>
              <FavStar :line="cityFavLine" small />
              <text class="chip-x" @click.stop="clearCityQuery" title="清除筛选，看回全市">✕</text>
            </view>
          </view>
          <view class="cc-meta">
            <text class="cm-item">{{ cityStampText }} · {{ cityNetNote }}</text>
          </view>
          <text class="cc-warn" v-if="cityWarnText">⚠ {{ cityWarnText }}</text>
          <view class="cc-bar" v-if="cityBusy"><view class="cc-bar-in" :style="{ width: cityProgress + '%' }"></view></view>
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

    <!-- 车速榜：全市态右上角浮窗（此时右侧栏隐藏，空间空着）。数据源就是当前快照，
         组件内部纯本地排序，切换档位 / 折叠都不发请求；点行走 selectBus + focusBus -->
    <SpeedRank
      v-if="cityOn && rankOpen"
      :buses="cityBuses"
      :meta="cityMeta"
      :busy="cityBusy"
      :stacked="orgSearchOpen && !rankPos"
      :pos="rankPos"
      @pick="onRankPick"
      @fold="onRankFold"
      @close="closeRank"
      @move="onRankMove"
    />

    <!-- 底部快捷操作栏：常驻贴底，分两组。
         组一「地图工具」：重扫 + 缩放 + 全览/站名/底图 + 方向（线路态）或全市功能（全市态）；
         组二「实时线路」：仅线路态，单独一组并突出，点按开合实时线路窗（不再选线自动弹出）。 -->
    <view class="bottom-bar" v-if="lineNo || cityOn">
      <view class="bb-group">
        <!-- 通用：重扫（线路态=刷新线路，全市态=重扫全网） -->
        <view class="bb-item" @click="bottomRescan" :title="cityOn ? (cityBusy ? '中止本轮拉取' : '重新拉取全网在运车辆') : (loading ? '刷新中…' : '立即刷新线路')">
          <text class="bb-ico" :class="{ spin: cityBusy || loading }">🔄</text>
          <text class="bb-label">重扫</text>
        </view>
        <view class="bb-sep"></view>
        <!-- 视图工具：缩放 / 全览 / 站名 / 底图 -->
        <view class="bb-item" @click="zoomBy(0.6)" title="放大">
          <text class="bb-ico">➕</text>
          <text class="bb-label">放大</text>
        </view>
        <view class="bb-item" @click="zoomBy(-0.6)" title="缩小">
          <text class="bb-ico">➖</text>
          <text class="bb-label">缩小</text>
        </view>
        <view class="bb-item" :class="{ on: cityOn ? false : true }" @click="resetView" :title="cityOn ? '全览全市在运车辆' : '全览整条线路'">
          <text class="bb-ico">🎯</text>
          <text class="bb-label">全览</text>
        </view>
        <view class="bb-item" :class="{ on: showStopLabels }" @click="toggleLabels" title="显示/隐藏站名">
          <text class="bb-ico">📍</text>
          <text class="bb-label">站名</text>
        </view>
        <view class="bb-item" v-if="!useMap" :class="{ on: showBaseMap }" @click="toggleBaseMap" title="显示/隐藏底图">
          <text class="bb-ico">🗺</text>
          <text class="bb-label">底图</text>
        </view>
        <!-- 方向分组：仅线路态显示，全市态不显示 -->
        <template v-if="!cityOn">
          <view class="bb-sep"></view>
          <view class="bb-item" :class="{ on: dirFilter === 0 }" @click="setDirView(0)" title="仅显示上行车辆">
            <text class="bb-ico up">⬆️</text>
            <text class="bb-label">上行</text>
          </view>
          <view class="bb-item" :class="{ on: dirFilter === 1 }" @click="setDirView(1)" title="仅显示下行车辆">
            <text class="bb-ico down">⬇️</text>
            <text class="bb-label">下行</text>
          </view>
          <view class="bb-item" :class="{ on: dirFilter === 2 }" @click="setDirView(2)" title="上下行同时显示">
            <text class="bb-ico all">🔀</text>
            <text class="bb-label">全部</text>
          </view>
        </template>
        <!-- 仅全市模式：车速榜 + 查车 + 跟随 + 编号标签 + 线网模式 -->
        <template v-else>
          <view class="bb-sep"></view>
          <view class="bb-item" :class="{ on: rankOpen }" @click="toggleRank" title="全局快照车速榜">
            <text class="bb-ico">🏁</text>
            <text class="bb-label">车速榜</text>
          </view>
          <view class="bb-item" :class="{ on: orgSearchOpen }" @click="toggleOrgSearch" title="按自编号查车">
            <text class="bb-ico">🔍</text>
            <text class="bb-label">查车</text>
          </view>
          <view class="bb-item" :class="{ on: cityFollow > 0 }" :title="cityFollowTitle" @click="cycleCityFollow">
            <text class="bb-ico">🔄</text>
            <text class="bb-label">{{ cityFollowLabel }}</text>
          </view>
          <view class="bb-item" :class="{ on: cityTagMode > 0 }" :title="'编号标签：' + cityTagModeLabel + '（点击切换）'" @click="toggleCityTags">
            <text class="bb-ico">🏷</text>
            <text class="bb-label">{{ cityTagModeLabel }}</text>
          </view>
          <view class="bb-item" :class="{ on: cityNetMode !== 'off' }" :title="'线网显示：' + cityNetModeLabel + '（点击切换 精简/全部/关闭）'" @click="cycleCityNetMode">
            <text class="bb-ico">🕷</text>
            <text class="bb-label">{{ cityNetModeLabel }}</text>
          </view>
        </template>
      </view>

      <!-- 组二：实时线路（仅线路态，单独一组、视觉突出） -->
      <view class="bb-group bb-group-stops" v-if="!cityOn">
        <view class="bb-item bb-stops" :class="{ on: stopsOpen }" @click="$emit('toggle-stops')" title="打开/关闭实时线路窗（站点·在线车辆·营运信息）">
          <text class="bb-ico">🚏</text>
          <text class="bb-label">实时线路</text>
        </view>
      </view>
    </view>

    <!-- 自编号查车：按输入末尾数字跨公司模糊匹配全市快照，随输入实时呈现。
         完整编号（321B2426）取尾号 2426，前 3/4 位公司代码不参与匹配；
         可与车速榜同时打开（此时下移到车速榜下方），纯本地过滤不发请求，点结果选中车辆并在地图定位 -->
    <view class="org-search" :class="{ 'with-rank': rankOpen && !orgPos && !rankPos }" :style="orgStyle" v-if="cityOn && orgSearchOpen">
      <view class="os-head">
        <text class="os-grip" title="按住拖动窗口" @click.stop>⣿</text>
        <text class="os-title">🔍 自编号查车</text>
        <view class="os-close" @click="closeOrgSearch" title="关闭">✕</view>
      </view>
      <view class="os-body">
        <view class="os-input-row">
          <input
            class="os-input"
            v-model="orgSearchInput"
            type="text"
            placeholder="尾号查询：2426 / 426 / 325F311"
            confirm-type="search"
            @input="onOrgInput"
            @confirm="doOrgSearch"
          />
          <view class="os-go" @click="doOrgSearch">🔍 查车</view>
        </view>
        <view class="os-tip">按自编号末尾数字跨所有公司匹配，输入时实时呈现；基于当前快照（{{ cityBuses.length }} 辆），不另发请求</view>

        <block v-if="orgResults.length">
          <view class="os-count" @click.stop>
            <view class="os-count-info">
              <text>找到 <text class="os-count-n">{{ orgResults.length }}</text> 辆</text>
              <text class="os-count-key">尾号 {{ orgQueryDigits }}</text>
            </view>
            <!-- 复制结果：档位（文字 / Excel / 图片）与全站共享，放在计数行右侧避免头部挤压 -->
            <CopyPill label="导出" :disabled="!orgResults.length" @copy="copyOrgResults" />
          </view>
          <scroll-view class="os-list" scroll-y>
            <view class="os-row" v-for="b in orgResults" :key="b.busId" @click="onOrgHitPick(b)">
              <view class="osr-top">
                <text class="osr-no">{{ b.no }} 路</text>
                <text class="osr-dir" :class="'d' + b.dir">{{ b.dir === 0 ? '上行' : '下行' }}</text>
                <text class="osr-org">{{ fmtNo(b.orgId) }}</text>
                <text class="osr-locate">定位 ›</text>
              </view>
              <view class="osr-sub">
                <text class="osr-route">{{ b.routeText }}</text>
                <text class="osr-speed">{{ b.speed != null ? b.speed + ' km/h' : '—' }}</text>
              </view>
              <view class="osr-foot">
                <text class="osr-company" v-if="b.company">{{ b.company }}</text>
                <text class="osr-stop" :title="b.stopName ? '所处站点：' + b.stopName : '站点信息加载中'">📍{{ b.stopName || '站点…' }}</text>
              </view>
            </view>
          </scroll-view>
        </block>
        <view class="os-miss" v-else-if="orgSearchMsg">{{ orgSearchMsg }}</view>
      </view>
    </view>

    <!-- 右侧栏：实时车辆面板在上，发车时刻表面板独立挂在它下方（两张卡各自成块，不共用一个面板壳）。
         全市态整栏隐藏：这里的内容属于「当前这一条线」，与全市分布不是一个作用域，且要把画面让给车点 -->
    <view class="side-col" v-if="!cityOn">
      <!-- 实时车辆面板（可折叠，列表随视角方向过滤） -->
      <view class="panel" :class="{ collapsed: panelCollapsed, 'menu-open': refreshMenu }">
        <view class="panel-header">
          <view class="panel-title">实时车辆（{{ shownBuses.length }}辆）</view>
          <FavStar v-if="lineNo && !cityOn" :line="favLine" small />
          <view class="collapse-btn" :class="{ folded: panelCollapsed }" @click="panelCollapsed = !panelCollapsed" :title="panelCollapsed ? '展开' : '折叠'">▾</view>
        </view>
        <!-- 线路号徽章 + 所属营运公司徽标：紧跟在标题下方，仅在有线路号时显示 -->
        <view class="panel-line-info" v-if="lineName">
          <view class="pli-badge">{{ lineName }}{{ roadUnit ? '路' : '' }}</view>
          <view class="pli-companies" v-if="operatorCompanies.length || orgBadge">
            <view class="org-tag" v-for="c in operatorCompanies" :key="c.no" :title="c.label">
              <text class="org-no">{{ c.no }}</text>
              <text class="org-name">{{ c.short }}</text>
            </view>
            <view class="org-tag foreign" v-if="orgBadge" :title="orgBadge.full">
              <image class="org-logo" :src="companyLogo" mode="aspectFit" />
              <text class="org-name">{{ orgBadge.label }}</text>
            </view>
          </view>
        </view>
        <!-- 非集团线路：高德只提供静态站点与走向，没有实时车辆，明确标注避免误以为是故障 -->
        <view class="foreign-note" v-if="isForeignLine && !cityOn">
          <image v-if="foreignCompany" class="fn-logo" :src="companyLogo" mode="aspectFit" />
          <text>{{ foreignCompany ? foreignCompany.label : '其它公交' }} · 高德静态数据：含站点与走向，无实时车辆/发车计划</text>
        </view>
        <!-- 刷新行：左半 ↻ 立即拉一次；右半显示当前间隔，单击展开 手动 / 15秒 / 20秒 / 30秒 -->
        <view class="panel-tools">
          <view class="refresh-wrap">
            <view class="refresh-pill" :class="{ busy: loading, auto: refreshSec > 0 }">
              <view class="rp-refresh" @click="refreshNow" :title="loading ? '刷新中…' : '立即刷新'">
                <text class="rp-ico" :class="{ spin: loading }">↻</text>
              </view>
              <view class="rp-split"></view>
              <view class="rp-mode" @click="toggleRefreshMenu" :title="refreshTitle">
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
          <CopyPill label="导出" :disabled="!shownBuses.length" @copy="copyOnlineBuses" />
          <text class="pt-hint">{{ refreshSec > 0 ? '自动刷新中' : '仅点 ↻ 时拉取' }}</text>
        </view>
        <view class="panel-body" v-show="!panelCollapsed">
          <!-- 普通 view + overflow-y 自己滚：不用 <scroll-view>，它在 flex 限高下内层会涨到内容高（宿主 overflow 可视），车一多就画到卡外面 -->
          <view class="bus-list" v-if="shownBuses.length">
            <view class="bus-group" v-for="g in groupedBuses" :key="'g' + g.dir">
              <view class="bus-group-head">
                <text class="bus-dir" :class="g.loop ? 'loop' : 'd' + g.dir">{{ g.name }}</text>
                <text class="bus-group-count">{{ g.buses.length }} 辆</text>
              </view>
              <view class="bus-item" v-for="(bus, i) in g.buses" :key="bus.dir + '-' + i" @click="selectBus(bus)" :title="busTip(bus)">
                <view class="bus-left">
                  <!-- ★ 自编号（由 MD5 加密值还原，补全车型字母，如 325F311） -->
                  <view class="bus-org">{{ bus.orgId ? fmtNo(bus.orgId) : '未知' }}</view>
                  <!-- 所在站点：K-d Tree 最近一站，与复制/Tooltip 同口径；MD5 沉底作备查 -->
                  <view class="bus-stop">📍 {{ nearStopOf(bus) }}</view>
                  <view class="bus-hash">{{ bus.busNo }}</view>
                </view>
                <view class="bus-right">
                  <view class="bus-speed">
                    <text class="bus-state" :class="busStateCls(bus)">{{ busStateText(bus) }}</text>
                    <text class="bus-kmh">{{ bus.gpsSpeed }} km/h</text>
                  </view>
                  <view class="bus-time">🕐 {{ bus.time }}</view>
                </view>
              </view>
            </view>
          </view>
          <view class="empty" v-else>当前{{ dirFilterLabel === '全部' ? '' : dirFilterLabel }}没有在线车辆</view>
        </view>
      </view>

      <!-- 发车时刻表面板（原独立整屏视图移到这里）：上行与下行同屏各一组，不随控制卡视角二选一；
           自带折叠键（与车辆面板同一枚圆键），两张卡各自成块、各折各的 -->
      <view class="plan-side" v-if="lineNo">
        <!-- 传在线车辆标识：发车时刻据此判断班次是否已实际发出，消除过点残留的「待发」 -->
        <LinePlan
        :line-no="lineNo"
        :online-bus-keys="onlineBusKeys"
        :line-name="lineName"
        :road-unit="roadUnit"
        :operator-companies="operatorCompanies"
        :org-badge="orgBadge"
        :company-logo="companyLogo"
      />
      </view>
    </view>

    <!-- 刷新间隔下拉的"点外部关闭"透明遮罩：面板带 backdrop-filter 会形成包含块，遮罩只能放在面板外 -->
    <view class="rm-mask" v-if="refreshMenu" @click="closeRefreshMenu"></view>

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
          <text class="sheet-line" :title="sheetTitle">{{ sheetTitle }}</text>
          <text class="sheet-dir" :class="isLoop ? 'loop' : 'd' + selectedBus.dir">{{ dirLabel(selectedBus.dir) }}</text>
          <view class="org-tag" :class="{ foreign: selectedBusOrg && selectedBusOrg.foreign }" v-if="selectedBusOrg" :title="selectedBusOrg.label">
            <image v-if="selectedBusOrg.foreign" class="org-logo" :src="companyLogo" mode="aspectFit" />
            <text v-else class="org-no">{{ selectedBusOrg.no }}</text>
            <text class="org-name">{{ selectedBusOrg.short }}</text>
          </view>
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
      <!-- 营运公司已并入标题行（方向徽标右侧），不再单独占行 -->
      <!-- 当前走向：起绿点 / 终琥珀点，站名 → 箭头，方向徽标靠右 -->
      <view class="sheet-route" v-if="sheetRoute">
        <view class="sr-line">
          <text class="sr-dot sr-start" title="起点站"></text>
          <text class="sr-name sr-from" :title="sheetRoute.from">{{ sheetRoute.from }}</text>
          <text class="sr-arrow">→</text>
          <text class="sr-dot sr-end" title="终点站"></text>
          <text class="sr-name sr-to" :title="sheetRoute.to">{{ sheetRoute.to }}</text>
          <text class="sr-dir" :class="isLoop ? 'loop' : 'd' + sheetRoute.dir">{{ dirLabel(sheetRoute.dir) }}</text>
        </view>
      </view>
      <!-- 2×2 指标网格：小标签在上、数值在下，短值各占半行宽度，省掉四行横排 -->
      <view class="sheet-grid">
        <view class="sg-cell">
          <text class="sg-k">自编号</text>
          <view class="sg-v">{{ selectedBus.orgId ? fmtNo(selectedBus.orgId) : '编号还原中…' }}</view>
        </view>
        <view class="sg-cell">
          <text class="sg-k">车速</text>
          <view class="sg-v">
            <text class="sg-num" :style="{ color: speedBandColor }">{{ selectedBus.gpsSpeed }}</text>
            <text class="sg-u">km/h</text>
          </view>
        </view>
        <view class="sg-cell">
          <text class="sg-k">运行状态</text>
          <view class="sg-v"><text class="sg-num" :style="{ color: busStateColor }">{{ busStateText(selectedBus) }}</text></view>
        </view>
        <view class="sg-cell">
          <text class="sg-k">GPS 时间</text>
          <view class="sg-v">{{ selectedBus.time }}</view>
        </view>
      </view>
      <!-- 坐标精度收敛到 6 位（≈0.1m，高于 GPS 自身精度），原始 17 位小数会折成两行 -->
      <view class="sheet-coord" :title="busCoord">
        <text class="sg-k">坐标 · GCJ-02</text>
        <text class="sc-v">{{ busCoord }}</text>
      </view>
      <view class="sheet-btns">
        <view class="sheet-btn" @click="focusBus(selectedBus)" title="居中并把地图放到最大，精确查看这辆车">📍 在地图上定位</view>
        <!-- 全市态下的出口：从一辆车跳到它所属的线路（看得到走向、站点与同线其他车） -->
        <view class="sheet-btn go" v-if="cityOn && selectedBus.code" @click="openCityLine(selectedBus)" :title="'切换到 ' + selectedBus.no + ' 路地图'">🗺 打开 {{ selectedBus.no }} 路</view>
      </view>
    </view>

    <!-- 站点详情窗：点站名 / 站点圆点弹出（与车辆详情窗同一套玻璃浮窗与拖拽交互，
         class 保留 bus-sheet 以复用 bindSheetDrag/clampSheetPos 的 DOM 查找；两窗互斥同显） -->
    <view class="bus-sheet stop-sheet" v-if="selectedStop" :class="{ pinned: sheetPinned, dragging: sheetDragging }" :style="sheetStyle">
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
          <text class="sheet-line" :title="selectedStop.name">{{ selectedStop.name }}</text>
          <text class="sheet-dir" :class="isLoop ? 'loop' : 'd' + selectedStop.dir">{{ dirLabel(selectedStop.dir) }}</text>
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
      <!-- 方向 / 所属线路 / 换乘条数合并成一行元信息，省掉两行左右分栏 -->
      <view class="sheet-sub">
        <text class="ss-tag">{{ dirLabel(selectedStop.dir) }} · {{ stopLineLabel }}</text>
        <text class="ss-org">{{ stopLinesBusy ? '全市线网匹配中…' : stopLines.length + ' 条可换乘 · 点击切换' }}</text>
      </view>
      <!-- 换乘线路：两列卡片网格。10 条左右一屏看全，不必逐条滚动；
           上排线路号（当前线路琥珀高亮 + 标记），下排「开往 终点站」，完整起讫站留在 title -->
      <view class="st-list">
        <view
          class="st-chip"
          v-for="t in stopLines"
          :key="t.no"
          :class="{ cur: t.cur }"
          @click="openStopLine(t)"
          :title="(t.cur ? '当前线路 · ' : '点击切换至 ') + t.no + ' 路（' + (t.start || '?') + ' → ' + (t.end || '?') + '）· ' + (t.company ? t.company.full || t.company.label : '')"
        >
          <view class="st-top">
            <text class="st-no">{{ t.no }}</text>
            <!-- 所属营运公司徽标：紧跟在线路号后方，公司色描边 + 半透明底，
                 一眼看出这条换乘线是哪家在跑（公交集团 / 蔡城 / 木兰 / 汉奇） -->
            <view
              class="org-tag"
              :class="{ foreign: t.orgTag && t.orgTag.isForeign }"
              v-if="t.orgTag"
              :title="t.company.full || t.company.label"
            >
              <image v-if="t.orgTag.isForeign" class="org-logo" :src="t.orgTag.logo" mode="aspectFit" />
              <text v-else class="org-no">{{ t.orgTag.no }}</text>
              <text class="org-name" :title="t.company.label">{{ t.orgTag.short }}</text>
            </view>
            <text class="st-cur" v-if="t.cur">当前</text>
            <view class="st-go" v-else>↗</view>
          </view>
          <view class="st-end" :title="(t.start || '?') + ' → ' + (t.end || '?')">
            <text class="st-to">开往</text><text class="st-dest">{{ t.end || '起讫站未知' }}</text>
          </view>
        </view>
        <view class="st-none" v-if="stopLinesBusy"><text>正在全市线网中匹配途经本站的线路…</text></view>
        <view class="st-none" v-else-if="!stopLines.length">
          <text>全市线网中未找到其它途经该站的线路</text>
        </view>
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
import { getAmapKey, bumpAmapUsage } from '../utils/settings.js'
import { assetUrl } from '../utils/asset.js'
import { distance } from '../utils/geo.js'
import { allLines, findLine, isLoopLine } from '../utils/lineIndex.js'
import { createResizable } from '../utils/panelResize.js'
import { readPanelPos, writePanelPos, clampPanelPos, bindFloatDrag } from '../utils/panelPos.js'
import {
  citySweepCost, sweepCity, loadSnapshot, loadLastSnapshot, snapshotAge,
  findBusByOrgId, searchBusesByOrgSuffix, refreshOrgIds, clusterPoints, SPEED_BANDS, speedBandOf, CITY_FRESH_MS,
  cityWarned, markCityWarned, loadCityNet, netSearchLines, bboxIntersects,
} from '../utils/cityBus.js'
import LinePlan from './LinePlan.vue'
import Signboard from './Signboard.vue'
import SpeedRank from './SpeedRank.vue'
import {
  getRefreshSec, setRefreshSec as saveRefreshSec, onRefreshSecChange, REFRESH_OPTS,
  accentRgba, getAccent,
} from '../utils/settings.js'
import { cleanStops, dedupLegacyStops, pointsOf, fromFlat } from '../utils/routeClean.js'
import { loadLineAsset, assetDir } from '../utils/lineAsset.js'
import { orgCompanyOf, routeOf } from '../utils/speedRank.js'
import { formatBusNo, onBusNumberReady } from '../utils/busNumber.js'
import { copyTable } from '../utils/clipboard.js'
import { attachDropdown } from '../utils/dropdown.js'
import { orgInfo, COMPANIES, companyKeyOfNo, companyOf } from '../utils/companies.js'
import { build as kdtreeBuild, nearest as kdtreeNearest } from '../utils/kdtree.js'
import { estimateDirection, heading } from '../utils/busDir.js'
import FavStar from './FavStar.vue'
import CopyPill from './CopyPill.vue'

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
// 环形线路专用配色（环线没有上下行）：走向 / 站点 / 车辆统一改用紫罗兰色系，
// 与上行青、下行玫红都明显拉开，避免被误读成某一方向。
const LOOP_STYLE = {
  name: '环形', casing: '#FFFFFF', inner: '#8B5CF6', svgStroke: '#A78BFA', bus: '#C4B5FD', labelText: '#6D28D9',
}
// 刷新间隔（秒）：0 = 手动。全站统一真源在 utils/settings.js，
// 地图页与实时线路 / 极简站牌 / 账号与设置里的刷新控件共用一份值并即时同步。
// —— 全市实时分布 ——
// 自动跟随档位（分钟）：0 = 手动。一轮扫描 ≈ 1535 个请求（生产环境全部走 Worker 反代），
// 所以不给 15/30 秒这种线路态档位，最低 5 分钟且默认关闭，配额代价写在按钮提示里。
const CITY_FOLLOW_OPTS = [0, 5, 15, 30]
const CITY_FOLLOW_KEY = 'whbis:city-follow-sec'
// 车速榜 / 自编号查车开启态：本机记忆。两窗常驻——默认打开，只有点浮窗右上角 ✕ 才清除；
// 切视图 / LineMap 被卸载重建都不该让它们自动消失（全市态专属，回到全市态自动复现）
const RANK_OPEN_KEY = 'whbis:rank-open'
const ORG_OPEN_KEY = 'whbis:org-search-open'
const ORG_INPUT_KEY = 'whbis:org-search-input'
// 两窗拖动后的位置：复用 panelPos.js 的读写/夹取，键名与浮窗 class 对齐
const RANK_POS_KEY = 'rank-card'
const ORG_POS_KEY = 'org-search'
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
// 线网显示模式：off 关闭 / lite 精简（只画主干+当前视野重点，默认）/ full 全部逐条
const CITY_NET_MODE_KEY = 'whbis:city-net-mode'
const CITY_NET_MODES = ['lite', 'full', 'off']
// 精简模式逐条绘制上限（只突出站点多的主干，其余交给淡色背景纹理）
const CITY_NET_LITE_PATHS = 90
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
// 行驶状态：到站 / 离站 / 行驶 / 停靠
// 注：arrived==='1' 是后台字段，仅表示本次班次已到终点站；中间站不停用此字段。
// 「离站」判定：车辆已离开上一站 > DEPARTED_DIST_THRESHOLD，但仍可能因 GPS 延迟显示速度为 0。
const DEPARTED_DIST_THRESHOLD = 500 // 米：离前一站超过此距离才认为是「已离站」

/**
 * 将车位投到路线 polyline，返回沿线累积距离（米）
 * 用于 nearStopOf 和 nearStopData 共享定位逻辑。
 */
function cumDistAlongRoute(segs, lat, lng) {
  if (!segs || segs.length < 2) return null
  let projI = 0, bestD2 = Infinity
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i], c = segs[i + 1]
    const dx = c.lng - a.lng, dy = c.lat - a.lat
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / len2)) : 0
    const px = a.lng + t * dx, py = a.lat + t * dy
    const d2 = (px - lng) ** 2 + (py - lat) ** 2
    if (d2 < bestD2) { bestD2 = d2; projI = i }
  }
  let cum = 0
  for (let i = 0; i < projI; i++) {
    const a = segs[i], c = segs[i + 1]
    cum += Math.sqrt((c.lng - a.lng) ** 2 + (c.lat - a.lat) ** 2)
  }
  {
    const a = segs[projI], c = segs[projI + 1]
    const dx = c.lng - a.lng, dy = c.lat - a.lat
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / len2)) : 0
    cum += t * Math.sqrt(len2)
  }
  return cum
}

/**
 * 辅助：route 统一为 [{lat,lng}] 格式
 */
function normSegs(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null
  const first = raw[0]
  if (Array.isArray(first) && typeof first[0] === 'number') return raw.map(([ll, la]) => ({ lat: la, lng: ll }))
  if (first && typeof first.lat === 'number') return raw
  return null
}

function nearStopData(b, stops, route) {
  if (!stops?.length) return { toPrev: Infinity, toCur: Infinity, toNext: Infinity }
  const lat = parseFloat(b.lat) || 0, lng = parseFloat(b.lng) || 0
  const segs = normSegs(route)
  // 用 cumDist 找到站点段 [i, i+1]（与 nearStopOf 同逻辑）
  if (segs) {
    const cum = cumDistAlongRoute(segs, lat, lng)
    if (cum !== null) {
      const cumStops = [0]
      for (let i = 0; i < stops.length - 1; i++) {
        cumStops.push(cumStops[i] + distance(parseFloat(stops[i].latitude), parseFloat(stops[i].longitude), parseFloat(stops[i + 1].latitude), parseFloat(stops[i + 1].longitude)))
      }
      let lo = 0, hi = cumStops.length - 1
      while (lo < hi) { const m = (lo + hi + 1) >> 1; cumStops[m] <= cum ? (lo = m) : (hi = m - 1) }
      const i = lo
      if (i >= stops.length - 1) return { toPrev: Infinity, toCur: Infinity, toNext: Infinity }
      const dI = distance(lat, lng, parseFloat(stops[i].latitude), parseFloat(stops[i].longitude))
      const dIp1 = distance(lat, lng, parseFloat(stops[i + 1].latitude), parseFloat(stops[i + 1].longitude))
      // 若车位在 segment [i,i+1] 但更靠近 i+2，则退化为 i+1 作为当前站
      const dNext = i + 2 < stops.length ? distance(lat, lng, parseFloat(stops[i + 2].latitude), parseFloat(stops[i + 2].longitude)) : Infinity
      return {
        toPrev: dI,
        toCur: dIp1 <= dI ? dIp1 : dI,
        toNext: dNext,
      }
    }
  }
  // 无路线时退化为 haversine 最近站
  let bestI = -1, bestD = Infinity
  for (let i = 0; i < stops.length; i++) {
    const d = distance(lat, lng, parseFloat(stops[i].latitude), parseFloat(stops[i].longitude))
    if (d < bestD) { bestD = d; bestI = i }
  }
  if (bestI < 0) return { toPrev: Infinity, toCur: Infinity, toNext: Infinity }
  return {
    toPrev: bestI > 0 ? distance(lat, lng, parseFloat(stops[bestI - 1].latitude), parseFloat(stops[bestI - 1].longitude)) : Infinity,
    toCur: bestD,
    toNext: bestI < stops.length - 1 ? distance(lat, lng, parseFloat(stops[bestI + 1].latitude), parseFloat(stops[bestI + 1].longitude)) : Infinity,
  }
}
function busStateOf(b, stops, route) {
  if (b.arrived === '1') return '到站'
  const d = nearStopData(b, stops, route)
  const spd = parseFloat(b.gpsSpeed || 0)
  // 离站：车辆已超前一站，且未到下一站
  if (d.toPrev > DEPARTED_DIST_THRESHOLD && d.toCur <= d.toNext) return '离站'
  if (spd === 0) return '停靠'
  return '行驶'
}

// 把点投影到线段数组上，返回最近段索引 bestI 和投影点坐标 proj{Lat,Lng}
function projectOnSegs(segs, lat, lng) {
  let bestDist = Infinity, bestI = -1
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i], c = segs[i + 1]
    const dx = c.lng - a.lng, dy = c.lat - a.lat
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / len2)) : 0
    const projLat = a.lat + t * dy, projLng = a.lng + t * dx
    const d = (projLat - lat) ** 2 + (projLng - lng) ** 2
    if (d < bestDist) { bestDist = d; bestI = i }
  }
  if (bestI < 0) return null
  const a = segs[bestI], c = segs[bestI + 1]
  const dx = c.lng - a.lng, dy = c.lat - a.lat
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / len2)) : 0
  return { i: bestI, lat: a.lat + t * dy, lng: a.lng + t * dx }
}

// —— 自绘走向图的 Web Mercator 投影工具 ——
// 经纬度 → 单位平面坐标（u/v 均在 0~1），屏幕像素 = (u - cam.u) * 256 * 2^zoom + 屏幕偏移
const mercX = (lng) => (lng + 180) / 360
const mercY = (lat) => {
  const r = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}
const zoomScale = (z) => 256 * Math.pow(2, z)
// Mercator 逆投影：定位时要把"希望车出现的屏幕点"反算成地图中心
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
// 走向路径构造：
// - snapped（已贴路、轨迹点密集）：点够密，直接用直线段连接最自然顺滑，
//   任何曲线插值反而会在每段外鼓、产生波浪式弯折（旧实现的症结）。
// - 非 snapped（站间直连回退、点稀疏）：用 Catmull‑Rom 转贝塞尔的样条，
//   曲线严格经过每个站点、切线连续，把折角圆滑成自然转弯，且不甩头越界。
function smoothPath(pts, snapped) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  const f = (n) => n.toFixed(1)
  if (snapped || pts.length < 3) {
    let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`
    for (let i = 1; i < pts.length; i++) d += ` L ${f(pts[i].x)} ${f(pts[i].y)}`
    return d
  }
  // Catmull‑Rom：对每段 P[i]→P[i+1] 取控制点 c1/c2（端点钳位），转成三次贝塞尔
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`
  }
  return d
}

// 把屏幕点吸附到折线最近线段的垂足。走向线经过 sideShift 分轨 + 贴路几何重采样后，
// 已经不再穿过站台的原始经纬度投影点，若站点圆点仍用原始坐标画，就会与线路系统性错开
// （弯道 / 上下行同屏时最明显）。超过 maxDist 说明这条走向确实不经过该站点，保留原点，
// 以免把站点硬拽到错误的走廊上掩盖数据问题。
function snapToRoute(pts, x, y, maxDist = 40) {
  if (!pts || pts.length < 2) return null
  let best = null
  let bestD2 = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-6) continue
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = a.x + t * dx
    const py = a.y + t * dy
    const d2 = (x - px) * (x - px) + (y - py) * (y - py)
    if (d2 < bestD2) {
      bestD2 = d2
      best = { x: px, y: py }
    }
  }
  return best && bestD2 <= maxDist * maxDist ? best : null
}

export default {
  components: { LinePlan, Signboard, SpeedRank, FavStar, CopyPill },
  props: {
    lineCodeProp: { type: String, default: '' },
    initDirection: { type: Number, default: 0 },
    lineNameProp: { type: String, default: '' },
    embedded: { type: Boolean, default: false },
    // 宿主已把地图铺满整屏时不再需要「全屏查看」键（首页地图视图即如此）
    fsEnabled: { type: Boolean, default: true },
    // 全市公交视图由宿主顶部分段驱动（判据只留在宿主一处，组件不再自带开关）
    cityMode: { type: Boolean, default: false },
    // 仿真站牌设计：为真时线路走向改用站牌风格呈现（只影响自绘画布）
    simSignboard: { type: Boolean, default: false },
    // 实时线路站点窗是否打开（窗本身由宿主渲染）：仅用于底部栏按钮高亮
    stopsOpen: { type: Boolean, default: false },
  },
  data() {
    return {
      // 完整编号映射加载版本号（就绪后 ++，触发车辆编号显示刷新）
      mapVersion: 0,
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
      // 本线路站点加载是否已结束（含「查无此线」的空结果）：用于区分「正在加载」与「线路不存在」
      stopsLoaded: false,
      routeByDir: { 0: [], 1: [] },
      // K-d Tree 索引（按方向）：每方向站点变时重建，查询 nearest 是 O(log N)
      kdtrees: { 0: null, 1: null },
      // 上一帧的车辆位置快照（用于 estimateDirection 的运动向量计算）
      prevBusesByDir: { 0: [], 1: [] },
      // 走向贴路状态：idle 未开始 / loading 计算中 / ok 已贴路 / fail 失败（当前为站间直连）
      routeState: { 0: 'idle', 1: 'idle' },
      // 该方向的贴路几何是否来自静态资产且已贴路（是则跳过运行时 OSRM，避免重复请求）
      assetSnapped: { 0: false, 1: false },
      // 该方向是否已由用户自填高德 KEY 拉到官方公交轨迹（优先于 OSRM，阻止其回写覆盖）
      amapOfficial: { 0: false, 1: false },
      busesByDir: { 0: [], 1: [] },
      // 当前选中查看详情的车辆（null=不显示详情窗）
      selectedBus: null,
      // 详情窗：拖动后的像素位置（null = 用 CSS 默认位置）/ 是否已固定（锁定拖动）/ 是否正在拖动
      sheetPos: null,
      sheetPinned: false,
      sheetDragging: false,
      // 站点详情窗：点站名 / 站点圆点弹出；换乘线路列表由全市线网坐标匹配异步补齐
      selectedStop: null,
      stopLines: [],
      stopLinesBusy: false,
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
      // UI 占位（控制卡 / 右侧面板 / 车速榜 / 图例），用于计算路线可绘制区域
      uiRects: { ctrl: null, side: null, legend: null, rank: null },
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
      // 刚定位过的车辆：在自绘图上画一圈扩散波，告诉用户"就是这一个点"
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
      // 车速榜浮窗开关（只在全市态显示，纯本地排序快照，不发额外请求）。
      // 初值从本机恢复：LineMap 常因「未选线路时切出全市视图」被整个卸载，
      // 只靠组件内 data 会丢状态；只有关闭按钮会把它清掉。
      // 常驻：默认打开，只有显式存过 0（用户点过 ✕）才隐藏
      rankOpen: (() => {
        try { return uni.getStorageSync(RANK_OPEN_KEY) !== 0 } catch (e) { return true }
      })(),
      // 榜单是否折叠（由 SpeedRank 抛回）：折叠后只剩标题一条，不该继续占用右侧绘制区
      rankFolded: false,
      // 自编号查车浮窗：常驻，默认打开，只有显式存过 0 才隐藏
      orgSearchOpen: (() => {
        try { return uni.getStorageSync(ORG_OPEN_KEY) !== 0 } catch (e) { return true }
      })(),
      // 两窗拖动后的位置（{x,y} 视口绝对坐标，null=用 CSS 默认定位）
      rankPos: clampPanelPos(readPanelPos(RANK_POS_KEY), 720, 460),
      orgPos: clampPanelPos(readPanelPos(ORG_POS_KEY), 720, 320),
      _unbindOrgDrag: null,
      orgSearchInput: (() => {
        try { return String(uni.getStorageSync(ORG_INPUT_KEY) || '') } catch (e) { return '' }
      })(),
      orgQueryDigits: '',
      orgResults: [],
      orgSearchMsg: '',
      // 查车结果「所处站点」缓存：{ [线路号|方向]: [{stopName,latitude,longitude}] }
      // 站点明细按线路异步加载，命中后回填 b.stopName；复制时数据已就绪，保证富格式在手势栈内同步写入
      orgStopCache: {},
      // 按线路号筛选（缩小到某条线的车，不重新请求）
      cityFilterNo: '',
      // 自动跟随间隔（分钟，0=手动）
      cityFollow: 0,
      // 自绘模式下的全市圆点/聚合团（屏幕坐标，由 renderSchematic 算出）
      cityDots: [],
      // 全市线网走向路径（自绘模式）：[{ key, d, color, w, op }]
      cityNetPaths: [],
      // 线网显示模式：lite（默认，只突出主干）/ full（全部逐条）/ off（关闭线网）
      cityNetMode: 'lite',
      // 全市自编号标签（自绘模式，走 HTML 标签层）：[{ key, x, y, text, color, sel }]
      cityTags: [],
      // 线网统计（只放文案要用的字段；几何本体挂 this._net，5w 个数字进 data 会拖慢每帧）
      cityNetStat: null,
      cityNetBusy: false,
      // 线网就绪计数：_net 非响应式，靠它推原生折线重算
      cityNetTick: 0,
      // 线路号查询命中线网时的条目（统计行要显示它的方向数/站数）
      cityHitLine: null,
      // 编号标签模式：0=关闭 1=仅自编号 2=自编号+线路号（337 · 319N2379）
      cityTagMode: 1,
      // 原生视野变更计数：_view 是普通属性（非响应式），全市聚合要靠它触发重算
      viewTick: 0,
    }
  },
  computed: {
    // 车速分档颜色：与车速榜 SPEED_BANDS 同一套色（灰/绿/amber/红），一眼看出快慢
    speedBandColor() {
      const v = Number(this.selectedBus && this.selectedBus.gpsSpeed) || 0
      const band = speedBandOf(v)
      return SPEED_BANDS[band] ? SPEED_BANDS[band].color : '#e2e8f0'
    },
    // 运行状态颜色：到站=绿 / 离站=橙 / 行驶=青 / 停靠=琥珀，与自编号、车速同一套大字+配色模式
    busStateColor() {
      const s = busStateOf(this.selectedBus, this.stopsByDir[this.selectedBus.dir], this.routeByDir[this.selectedBus.dir])
      return s === '到站' ? '#6ee7b7' : s === '已离站' ? '#fb923c' : s === '行驶' ? '#67e8f9' : '#fcd34d'
    },
    // 当前线路是否为「非集团线路」（高德静态数据源，无实时车辆）
    isForeignLine() {
      return companyKeyOfNo(this.lineName || this.lineNo) !== 'JT'
    },
    // 非集团线路的公司信息（Logo / 名称 / 颜色），供控制卡徽标与收藏按钮使用
    foreignCompany() {
      if (!this.isForeignLine) return null
      const no = this.lineName || this.lineNo
      return orgInfo({ no, companyKey: companyKeyOfNo(no) }) ||
        { key: '', label: '其它公交', color: COMPANIES.JT.color, logo: COMPANIES.JT.logo }
    },
    companyLogo() {
      const c = this.foreignCompany
      return c && c.logo ? assetUrl(c.logo) : ''
    },
    // 控制卡上的公司徽标：非集团线路来自高德静态数据、没有实时车辆，
    // operatorCompanies 恒为空，这里直接取公司字典里的徽标（集团线不走这条，避免重复）
    orgBadge() {
      return this.isForeignLine ? this.foreignCompany : null
    },
    // 全市公交「已筛选」芯片的收藏摘要
    cityFavLine() {
      const no = String(this.cityFilterNo || '').trim()
      return { no, code: no, name: no, companyKey: companyKeyOfNo(no) }
    },
    // 收藏按钮的线路摘要（起讫站从当前方向的站点序列首末取）
    favLine() {
      const no = this.lineName || this.lineNo
      const stops = this.stopsByDir[this.direction] || []
      return {
        no, code: this.lineNo || no, name: no,
        start: stops.length ? (stops[0].stopName || '') : '',
        end: stops.length ? (stops[stops.length - 1].stopName || '') : '',
        companyKey: this.isForeignLine ? companyKeyOfNo(no) : 'JT',
        org: this.foreignCompany ? this.foreignCompany.full : '',
      }
    },
    // 仿真站牌：线路元数据（首末班 / 票价 / 终点优先取线路库索引，取不到回退站点序列）
    signboardLine() {
      const meta = findLine(this.lineNo) || {}
      const stops = this.stopsByDir[this.direction] || []
      return {
        no: this.lineNo || meta.no || '',
        name: this.lineName || meta.name || '',
        early: meta.early || '',
        last: meta.last || '',
        price: meta.price || '',
        start: meta.start || (stops[0] && stops[0].stopName) || '',
        end: meta.end || (stops[stops.length - 1] && stops[stops.length - 1].stopName) || '',
      }
    },
    // 仿真站牌：按当前视角方向分组（全部 = 上行 + 下行两组），空组不渲染；
    // 环形线没有上下行，只出一组「环形」
    signboardGroups() {
      const dirs = this.isLoop ? [0] : (this.dirFilter === 2 ? [0, 1] : [this.dirFilter])
      return dirs
        .map((d) => {
          const arr = this.stopsByDir[d] || []
          const stops = arr.map((s, i) => ({
            name: s.stopName || '',
            terminal: i === 0 || i === arr.length - 1,
          }))
          return {
            dir: d,
            dirName: this.dirLabel(d),
            from: (arr[0] && arr[0].stopName) || '',
            to: (arr[arr.length - 1] && arr[arr.length - 1].stopName) || '',
            stops,
          }
        })
        .filter((g) => g.stops.length)
    },
    // 宿主是否注入了 top 插槽
    hasTopSlot() {
      return !!this.$slots.top
    },
    // 渲染方式由「地图服务设置」决定：选"走向图"时即使填了 Key 也用自绘；
    // 未设置时按有无 Key 自动选择（保持旧行为）
    useMap() {
      return useNativeMap()
    },
    // 当前在线车辆的身份标识集合（busId MD5 + 还原的纯数字自编号），传给发车时刻面板：
    // 班次若能在此集合命中，说明车已实际在线运行（可能提前发出），不再标「待发」。
    onlineBusKeys() {
      const keys = []
      for (const d of [0, 1]) {
        for (const b of (this.busesByDir[d] || [])) {
          if (b.busId) keys.push(b.busId)
          if (b.orgId) keys.push(b.orgId)
        }
      }
      return keys
    },
    // 当前视角方向下的车辆列表（元素含 dir 字段 0/1）
    shownBuses() {
      const all = [...this.busesByDir[0], ...this.busesByDir[1]]
      return this.dirFilter === 2 ? all : all.filter((b) => b.dir === this.dirFilter)
    },
    // 按方向分组（参考发车时刻的分组方式）：全部视角分上行/下行两组，单方向只一组；空组不渲染。
    // 环形线没有上下行之分，直接合成一组，组名「环形」。
    groupedBuses() {
      if (this.isLoop) {
        const buses = [...this.busesByDir[0], ...this.busesByDir[1]]
        return buses.length ? [{ dir: 0, name: '环形', loop: true, buses }] : []
      }
      const name = { 0: '上行', 1: '下行' }
      const dirs = this.dirFilter === 2 ? [0, 1] : [this.dirFilter]
      return dirs
        .map((d) => ({ dir: d, name: name[d], buses: this.busesByDir[d] || [] }))
        .filter((g) => g.buses.length)
    },
    // 是否环形线路（408内环/外环…）：无上下行，换独立配色、隐藏方向切换、时刻表用「环形」
    isLoop() {
      return isLoopLine(this.lineName || this.lineNo)
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
      return REFRESH_OPTS
    },
    // 走向尚未贴路时的提示（初屏/服务故障时画的是站间直连，必须说明白）
    routeAlert() {
      const s = this.routeState
      if (s[0] === 'loading' || s[1] === 'loading') return '走向贴路计算中…（当前为站间直连，稍后自动替换）'
      const failed = ['fail'].includes(s[0]) && ['fail'].includes(s[1])
      if (failed) return '贴路服务暂不可用，当前为站间直连；可点"刷新"重试'
      return ''
    },
    // 详情窗标题：全市态显示这辆车自己的线路，线路态显示当前线路
    sheetTitle() {
      if (this.cityOn) return (this.selectedBus && this.selectedBus.no) || ''
      return this.lineName
    },
    // 详情窗「当前走向」：这辆车所属方向的起点站 → 终点站。
    // 优先取已加载的该方向站点明细（API/静态资产，最准）；没加载过（如全市态
    // 从车点直接点开、还没进过这条线）就退回本地静态索引 lines.json，
    // routeOf 会按方向反转下行，保证「上行 A→B / 下行 B→A」不会写反。
    sheetRoute() {
      const b = this.selectedBus
      if (!b) return null
      const dir = Number(b.dir)
      const d = dir === 0 || dir === 1 ? dir : Number(this.direction || 0)
      const no = (b.no != null && b.no !== '') ? b.no : this.lineNo
      // stopsByDir 属于 this.lineNo 这条线。全市态点开别线的车时它不会清空，
      // 必须先比对线路号，否则会把上一条线的起讫站安到这辆车上。
      const sameLine = String(no) === String(this.lineNo || '')
      const arr = sameLine ? (this.stopsByDir[d] || []) : []
      if (arr.length > 1) {
        const from = String(arr[0].stopName || '').trim()
        const to = String(arr[arr.length - 1].stopName || '').trim()
        if (from && to) return { dir: d, from, to }
      }
      const rt = routeOf(no, d)
      return rt.known ? { dir: d, from: rt.from, to: rt.to } : null
    },
    // 详情窗坐标：接口给的是 17 位小数，横排必然折行。收敛到 6 位（≈0.1m，
    // 已高于 GPS 定位精度），用等宽数字单行展示，完整原始值仍可从别处复制。
    busCoord() {
      const b = this.selectedBus
      if (!b) return ''
      const f = (v) => {
        const n = Number(v)
        return isFinite(n) && n !== 0 ? n.toFixed(6) : '—'
      }
      return `${f(b.lng)}, ${f(b.lat)}`
    },
    // 站点窗元信息里的线路名：宿主有时传「337」、有时传「337路」，统一只加一次「路」；
    // 环线（408内环/外环等）名称已含方向语素，不再追加「路」
    stopLineLabel() {
      const s = String(this.lineName || this.lineNo || '').trim()
      if (!s || /路$/.test(s) || /(内环|外环|内线|外线)$/.test(s)) return s
      return `${s} 路`
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
    // 时间戳只留"什么时候"，耗时是开发指标（已写在完成 toast 里），不占用户一行
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
    // 编号标签按钮标签：三档循环
    cityTagModeLabel() {
      return ['关闭', '自编号', '自编号+线路号+方向'][this.cityTagMode] || '编号标签'
    },
    cityFollowTitle() {
      if (!this.cityFollow) return '自动跟随：关（每次手动重扫）'
      return `每 ${this.cityFollow} 分钟重扫一次全网：约 ${Math.round((this.cityCost * 24 * 60) / this.cityFollow / 1000)}k 次请求/天，慎用`
    },
    cityNetModeLabel() {
      return this.cityNetMode === 'lite' ? '线网·精简' : this.cityNetMode === 'full' ? '线网·全部' : '线网·关闭'
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
        const st = this.routeStyle(dir)
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
            iconPath: assetUrl(isEnd ? `/static/img/stop-end-${dir}.png` : `/static/img/stop-dot-${dir}.png`),
            // 11px 在整线视野（scale ~13）下几乎看不见，提到 13px；首末站 19px 保持明显加重
            width: isEnd ? 19 : 13,
            height: isEnd ? 19 : 13,
          }
          // 站名开关：关闭时不挂 label，让工具行「站名」在原生模式下也能显隐站名贴片
          if (this.showStopLabels) {
            // 起点 / 终点加「起·/终·」前缀（绿/琥珀语义同自绘模式，marker 图标保持方向色）
            const endPrefix = isEnd ? (i === 0 ? '起' : '终') + '·' : ''
            stopMarker.label = {
              content: endPrefix + s.stopName,
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
            iconPath: assetUrl(`/static/img/bus-live-${dir}.png`),
            width: 30,
            height: 30,
            // 不给 marker 挂 callout，也**不能传 title**：uni-h5 的 MapMarker 会在点击时
            // 把 title 生成的 callout 切到可见（callout.visible = !visible），
            // 于是每点一次车图标，车头上方就多出一个"337 3240"白框，直到地图重建才消失。
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
      const sameDir = dirs.length > 1 && this.routeSameDirection()
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
        // 同向重合时 dir1 反向偏移，两条折线分居两侧（与自绘 sideShift 兜底一致）
        const pts = offsetPolyline(points, sameDir && dir === 1 ? -split : split)
        const st = this.routeStyle(dir)
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
    // （统计行会明说这个上限，不让用户误以为全市就这些线；完整线网请用"走向图"渲染方式）
    cityNativeNet() {
      void this.viewTick
      void this.cityNetTick
      void this.cityDirty
      const net = this._net
      if (!net || this.cityNetMode === 'off') return []
      const vp = this._cityViewport()
      const rect = this._cityRect(vp.w, vp.h)
      // lite 模式只绘站数最多的主干（原生覆盖物成本高，比自绘更该收敛）
      const cap = this.cityNetMode === 'lite' && !this.cityFilterNo ? Math.min(CITY_NET_LITE_PATHS, CITY_NET_MAX_NATIVE) : CITY_NET_MAX_NATIVE
      let dirs = this.pickCityDirs(rect, cap)
      if (this.cityNetMode === 'lite' && !this.cityFilterNo && dirs.length > 2) {
        dirs = [...dirs].sort((a, b) => b.n - a.n).slice(0, cap)
      }
      const out = []
      for (const d of dirs) {
        if (d.n < 2) continue
        const step = Math.max(1, Math.ceil(d.n / 80))
        const points = []
        // 按 parts（[from,to] 索引对）分段：跳变（飞线）处拆成多条折线，不跨段硬连
        const parts = d.parts || [[0, d.n - 1]]
        const st = DIR_STYLE[d.dir]
        for (const [from, to] of parts) {
          if (to - from < 1) continue
          const pts = []
          for (let i = from; i <= to; i += step) pts.push({ latitude: d.p[i * 2 + 1], longitude: d.p[i * 2] })
          if ((to - from) % step !== 0) pts.push({ latitude: d.p[to * 2 + 1], longitude: d.p[to * 2] })
          if (pts.length < 2) continue
          out.push({ points: pts, color: st.inner, width: this.cityFilterNo ? 5 : 2, arrowLine: false, dottedLine: !!d.suspect })
        }
      }
      return out
    },
    // 线路号是否在名称后追加「路」单位：环线（408内环 / 外环 / 内线 / 外线）名称已含方向语素，
    // 再追加会变成「408内环路」，故不追加
    roadUnit() {
      return !/(内环|外环|内线|外线)$/.test(String(this.lineName || '').trim())
    },
    // 所属营运公司：由在线车辆自编号（orgId，纯数字）首位推断，1 → 第一营运公司，依次类推
    operatorCompanies() {
      const set = new Set()
      this.shownBuses.forEach((b) => {
        const d = String(b.orgId || '').charAt(0)
        if (d >= '1' && d <= '9') set.add(Number(d))
      })
      return [...set]
        .sort((a, b) => a - b)
        // short 用于控制卡里的徽标（一行放不下全名，全名留给 title / 车辆详情窗）
        // 展示口径：只用单字序号「一公司 / 二公司」，去掉「第」；全名仍保留「第一营运公司」供 title
        .map((no) => ({ no, short: `${CN_ORG[no].replace(/^第/, '')}公司`, label: `武汉公交集团${CN_ORG[no]}营运公司` }))
    },
    // 车辆详情窗的所属公司徽标：与实时车辆面板同款（圆形序号 + 短名）。
    // 非集团线路（无 orgId 首位数字）走公司字典徽标，保证每辆车都有归属。
    selectedBusOrg() {
      const b = this.selectedBus
      if (!b) return null
      const d = String(b.orgId || '').charAt(0)
      if (d >= '1' && d <= '9') {
        const no = Number(d)
        return { no, short: `${CN_ORG[no].replace(/^第/, '')}公司`, label: `武汉公交集团${CN_ORG[no]}营运公司`, foreign: false }
      }
      const badge = this.orgBadge
      if (badge) return { no: '', short: badge.label, label: badge.full, foreign: true }
      return null
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
    // 自编号查车浮窗拖动后的位置；未拖动走 CSS 默认定位（与车速榜上下错开）
    orgStyle() {
      if (!this.orgPos) return null
      return { left: this.orgPos.x + 'px', top: this.orgPos.y + 'px', right: 'auto' }
    },
  },
  watch: {
    // 详情窗出现后给标题栏挂上原生鼠标拖动（uni-app 对 view 的 mouse 事件绑定不可靠）
    selectedBus(v) {
      if (v) this.$nextTick(() => this.bindSheetDrag())
      else this.unbindSheetDrag()
    },
    // 站点窗与车辆窗共用同一套拖拽绑定（两窗互斥同显，querySelector 只会命中在屏的那扇）
    selectedStop(v) {
      if (v) this.$nextTick(() => this.bindSheetDrag())
      else this.unbindSheetDrag()
    },
    // 地图重建（刷新 / 换方向 / 定位）会换掉 DOM，悬停监听要重新挂到新节点上
    mapKey() {
      this.$nextTick(() => this.bindHover())
    },
    // 仿真站牌开关：切换时重新决定是否接管地图手势（站牌层自带横向滚动）
    simSignboard(on) {
      this.$nextTick(() => {
        const el = document.querySelector('.schematic')
        if (!el) return
        if (on) {
          this.unbindGestures()
          el.style.touchAction = 'auto'
        } else {
          this.bindGestures()
        }
      })
    },
    // 侧栏（实时车辆 + 发车时刻）随「全市 / 单线路」视图切换而销毁重建，
    // 重建后必须重新挂缩放手柄并把记忆的尺寸（宽 + 高）还原，否则宽度记不住
    cityOn(v) {
      this.$nextTick(() => this.setupPanelResize())
      // 常驻面板随全市态 v-if 重建：重新绑拖动 grip（车速榜在子组件内自绑）
      if (v) this.$nextTick(() => this.bindOrgDrag())
    },
    // 宿主页顶部「上行/下行」切换 → 地图视角单向跟随（地图内仍可用「全部 / ⇄」自由查看）
    initDirection(v) {
      const d = Number(v || 0)
      if (d !== 2 && d !== this.dirFilter) this.setDirView(d)
    },
    // 宿主页换线：线码/线路名两个 prop 任一变化都原子同步（旧实现拆成多个 watch，
    // 子组件 watch 先于父组件刷新自身 lineName 那批回调，单独触发会读到滞后的 prop，曾把线路名停在上一条）
    lineCodeProp() { this.applyHostLine() },
    lineNameProp() { this.applyHostLine() },
    // 榜单浮窗出现/收起会改变右侧可绘制区，重新量一次占位
    rankOpen() {
      if (!this.rankOpen) this.rankFolded = false
      this.$nextTick(() => this.measureUi())
    },
    // 自编号查车浮窗出现/收起同样改变右侧可绘制区，重新量占位
    orgSearchOpen() {
      this.$nextTick(() => this.measureUi())
    },
    // 全市公交视图：宿主顶部分段是唯一入口，本组件不再自带开关
    cityMode(v) {
      if (v) { if (!this.cityOn) this.enterCity() }
      else if (this.cityOn) this.exitCity()
    },
  },
  mounted() {
    this.initFromProps()
    // 完整编号映射加载完成后刷新车辆编号显示（列表/详情窗自动更新，画布标签手动重绘）
    onBusNumberReady(() => {
      this.mapVersion++
      try { if (this.drawCityTags) this.drawCityTags() } catch (e) {}
      // 重绘线路走向图自绘层：车辆点旁的完整编号标签（svgBuses.label）依赖映射表
      try { this.renderSchematic() } catch (e) {}
    })
    attachDropdown(this, 'refreshMenu', 'refresh-map')
    // 恢复详情窗上次拖动过的位置（车辆窗 / 站点窗共用同一套浮窗与位置）
    // 此刻浮窗还没渲染，先按估算尺寸夹一次；开窗后 bindSheetDrag 会用实际尺寸再夹
    if (!this.sheetPos) this.sheetPos = clampPanelPos(readPanelPos('bus-sheet'), 320, 360)
    // #ifdef H5
    this._onWinResize = () => {
      this.syncCanvasSize()
      // 宽度变化会改变折行，记忆高度可能不够高；先按内容撑高再量占位
      if (this._resizers) this._resizers.forEach((r) => { if (r && r.refit) r.refit() })
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
      this.setupPanelResize()
    })
    // 订阅全站统一刷新设置：实时线路 / 极简站牌 / 设置面板任一处改动都会同步到地图页
    this._offRefresh = onRefreshSecChange((sec) => this.applyRefreshSec(sec))
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
    // 纯数字自编号 → 完整编号（依赖 mapVersion，映射就绪后重渲染）
    fmtNo(orgId) {
      void this.mapVersion
      return formatBusNo(orgId)
    },
    // 刷新间隔下拉：展开权交给全站仲裁器，点复制 / 搜索联想等其它菜单时自动收起
    toggleRefreshMenu() { if (this._dd) this._dd.toggle() },
    closeRefreshMenu() { if (this._dd) this._dd.close() },
    // 组件/页面卸载时统一清理（解绑手势、悬停、详情窗拖动、定位定时器、自动刷新）
    cleanup() {
      if (this._dd) this._dd.dispose()
      // #ifdef H5
      if (this._onWinResize) window.removeEventListener('resize', this._onWinResize)
      if (this._onFsKey) window.removeEventListener('keydown', this._onFsKey)
      // 全屏状态下被卸载（如切 Tab）时，别把 body 滚动锁留在页面上
      if (this.isFullscreen) document.body.style.overflow = ''
      // #endif
      this._onWinResize = null
      // 解绑查车浮窗拖动，避免切页后残留 document 监听
      if (this._unbindOrgDrag) { this._unbindOrgDrag(); this._unbindOrgDrag = null }
      // 取消待执行的重绘 / 量测帧，避免卸载后仍跑一次全市全量投影或 layout
      for (const k of ['_raf', '_measureRaf']) {
        if (this[k]) {
          if (typeof window !== 'undefined' && window.cancelAnimationFrame) window.cancelAnimationFrame(this[k])
          this[k] = null
        }
      }
      this.unbindGestures()
      this.unbindHover()
      this.unbindSheetDrag()
      if (this._resizers) { this._resizers.forEach((r) => r && r.destroy && r.destroy()); this._resizers = null }
      if (this._locTimer) clearTimeout(this._locTimer)
      // 在途的全网扫描：卸载后没人再消费它的结果，直接停掉（已扫到的部分不写缓存）
      if (this._cityToken) this._cityToken.cancelled = true
      if (this._offRefresh) {
        this._offRefresh()
        this._offRefresh = null
      }
      this.stopAutoRefresh()
    },
    // 组件化入口：从 props 读取线路并首次加载（页面形态下由 mounted 调用）
    // 宿主换线：四个线相关 prop 收敛到这一个同步点，全部以 prop 现值为准重建线路上下文
    applyHostLine() {
      const code = this.lineCodeProp || ''
      const name = this.lineNameProp || ''
      const lineNo = String(code).split('-')[1] || name || ''
      if (code === this.lineCode && lineNo === this.lineNo) return
      this.lineName = name || lineNo
      this.lineNo = lineNo
      this.lineCode = code
      this.searchNo = this.lineName
      if (!this.lineName && !this.lineNo) return
      // 清空旧线路缓存，避免叠加
      this.stopsByDir = { 0: [], 1: [] }
      this.stopsLoaded = false
      this.routeByDir = { 0: [], 1: [] }
      this.routeState = { 0: 'idle', 1: 'idle' }
      this.assetSnapped = { 0: false, 1: false }
      this.amapOfficial = { 0: false, 1: false }
      this.busesByDir = { 0: [], 1: [] }
      this.selectedBus = null
      this.camInited = false
      this._userMoved = false
      this._view = null
      if (this.useMap) this.mapKey++
      this.loadAllStops()
      this.loadLive()
    },
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
    // 搜索框"查询"：在当前页直接切换到输入的线路（保持当前视角方向）
    doSearchMap() {
      const no = (this.searchNo || '').trim()
      if (!no) {
        uni.showToast({ title: '请输入线路号', icon: 'none' })
        return
      }
      // 已停运线路不加载：无在运车辆可画，走向只是历史档案（线路库仍可查）。
      // 只拦手动输入；URL 进页 / 收藏直达不拦，保留查看历史档案的能力。
      const hit = findLine(no)
      if (hit && hit.status === '停运') {
        uni.showToast({ title: `「${hit.no}路」已停运${hit.stopDate ? '（' + hit.stopDate + ' 起）' : ''}`, icon: 'none' })
        return
      }
      const dir = this.dirFilter === 2 ? this.direction : this.dirFilter
      // 命中线路库时归一：请求用内部 code（H81→81），展示用对外号 hit.no
      this.loadByLine(hit ? (hit.code || hit.no) : no, dir, hit ? hit.no : no)
    },
    /**
     * 双方向几何是否「同向重合」：起终点都相近时，法向偏移会把两条线推向同一侧，
     * 后画的方向整条盖住先画的（曾出现在 amap 采集未反转 reversed 方向的资产上）。
     * 装载时已按 reversed 反转，这里再兜一层：命中就给 dir1 用反向偏移。
     */
    routeSameDirection() {
      const a = this.routeByDir[0] || []
      const b = this.routeByDir[1] || []
      if (a.length < 2 || b.length < 2) return false
      const near = (p, q) => p && q &&
        Math.abs(Number(p.latitude) - Number(q.latitude)) < 1e-5 &&
        Math.abs(Number(p.longitude) - Number(q.longitude)) < 1e-5
      return near(a[0], b[0]) && near(a[a.length - 1], b[b.length - 1])
    },
    // 走向色板：环形线统一用独立紫罗兰色，普通线路按上行/下行取色
    routeStyle(dir) {
      return this.isLoop ? LOOP_STYLE : DIR_STYLE[dir]
    },
    // 方向文案：环形线统一称「环形」，普通线路「上行 / 下行」
    dirLabel(dir) {
      return this.isLoop ? '环形' : (dir === 0 ? '上行' : '下行')
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
    // no 为请求用的内部编码（81），displayName 为对外展示号（H81）；缺省时展示号=no
    loadByLine(no, dir, displayName) {
      this.lineName = displayName || no
      this.lineNo = no
      this.direction = dir
      this.lineCode = buildLineCode(no, dir)
      // 清空上一条线路的全部缓存，避免叠加
      this.stopsByDir = { 0: [], 1: [] }
      this.stopsLoaded = false
      this.routeByDir = { 0: [], 1: [] }
      this.routeState = { 0: 'idle', 1: 'idle' }
      this.assetSnapped = { 0: false, 1: false }
      this.amapOfficial = { 0: false, 1: false }
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
      // 静态资产优先：一次 HTTP（浏览器缓存）同时拿到「离线清洗过的站点明细」与
      // 「离线算好的走向几何」。命中即不发 /line，也不受 OSRM 公共 demo 限速影响。
      // 资产是分片按需加载的，缺失/404 会返回 null，下面原链路照常兜底。
      let asset = null
      try { asset = await loadLineAsset(this.lineNo) } catch (e) { asset = null }
      if (asset) {
        for (const d of [0, 1]) {
          const row = assetDir(asset, d)
          if (!row || !Array.isArray(row.stops) || row.stops.length < 2) continue
          // 资产里可能残留改线前的旧站（同序号+同名的新旧两版），渲染前剔除
          this.stopsByDir[d] = dedupLegacyStops(row.stops)
          const flat = Array.isArray(row.route) && row.route.length >= 4 ? row.route : null
          let geo = flat ? fromFlat(flat) : []
          // 采集端 scan-routes-amap.mjs 已按 amap.reversed 把几何反转后写盘（dirRoute），
          // route 点序此刻已与本方向站序一致；amap.reversed 仅作元数据标记。
          // 这里绝不能再反转一次：否则几何方向倒过来，与站点首尾错开，
          // ptsOf() 的首末站锚定会把首站硬接到远端几何端点，画出横跨全线的 V 形绕行。
          if (geo.length > 1) {
            this.routeByDir[d] = geo
            this.routeState[d] = 'ok'
            this.assetSnapped[d] = row.snapped === true
          }
        }
      }
      // 资产没覆盖到的方向仍走 /line，但站点序列先清洗：
      // 过滤 0/0 与越界、按 stopNo 排序、去重、剔孤立错点与折返簇（否则会画出巨大折返）
      const missing = [0, 1].filter((d) => !(this.stopsByDir[d] && this.stopsByDir[d].length))
      for (const d of missing) {
        try {
          const data = await fetchLine(buildLineCode(this.lineNo, d))
          this.stopsByDir[d] = cleanStops((data && data.stopDetailList) || []).stops
        } catch (e) {
          this.stopsByDir[d] = []
        }
      }
      // 站点加载结束（资产 / /line 都试过），即便结果为空也是「查无此线」，不再是「正在加载」
      this.stopsLoaded = true
      // 站点序列定稿后重建 K-d tree：下一次 loadLive 拿到的车辆就近站匹配从 O(N) 降到 O(log N)
      for (const d of [0, 1]) {
        const arr = this.stopsByDir[d] || []
        const pts = arr.map((s, i) => ({ lat: parseFloat(s.latitude), lng: parseFloat(s.longitude), i }))
        this.kdtrees[d] = pts.length >= 2 ? kdtreeBuild(pts).tree : null
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
      // 自绘走向：OSRM 立即后台补算（保证无 KEY 时走向即时可用）；
      // 有用户自填高德 KEY 时并行拉官方轨迹，成功后覆盖 OSRM（取不到则保留 OSRM 结果）
      this.planRouteViaOsrm()
      this.planRouteViaAmapKey()
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
        // 原生地图模式（useMap）也走同一套状态标记：几何在就是 ok，不在就是 fail（画细虚线并提示）
        for (const dir of [0, 1]) {
          this.routeState[dir] = this.routeByDir[dir] && this.routeByDir[dir].length > 1 ? 'ok' : 'fail'
        }
        this.renderSchematic()
      }
    },
    // 用户自填高德 KEY：动态注入 JS API（自绘模式没有原生 <map>，不会自动加载 AMap），
    // 再用 LineSearch 官方公交轨迹替换 OSRM 贴路，换取更精确的线路走向。
    // 注入失败 / 超时 / 轨迹不匹配时返回 false，由调用方回退 OSRM；全程静默不打扰用户。
    loadAmapJsApi(key) {
      // 只有「当前这个 KEY 注入的」AMap 才能复用。换 KEY 后全局 window.AMap 仍是旧 SDK，
      // 直接复用会让新 KEY 永远不生效——必须先清掉再重新注入（这是「配置 KEY 不起作用」的根因之一）。
      if (window.AMap && typeof window.AMap.plugin === 'function' && window.__whbisAmapKey === key) {
        return Promise.resolve(window.AMap)
      }
      // 同一 KEY 的注入只发一次，并发请求共享同一个 Promise
      if (this._amapInject && this._amapInject.key === key) return this._amapInject.promise
      const promise = new Promise((resolve, reject) => {
        const t0 = Date.now()
        const check = () => {
          if (window.AMap && typeof window.AMap.plugin === 'function') return resolve(window.AMap)
          if (Date.now() - t0 > 12000) return reject(new Error('AMap 注入超时'))
          setTimeout(check, 250)
        }
        // 安全密钥：高德 JS API 2.0 起 Web 端 key 需配对安全密钥，用户可在 KEY 后用英文逗号附带
        const [jsKey, jsSecret] = String(key).split(/[,，]/).map((s) => (s || '').trim())
        if (jsSecret) window._AMapSecurityConfig = { securityJsCode: jsSecret }
        else { try { delete window._AMapSecurityConfig } catch (e) { window._AMapSecurityConfig = undefined } }
        // 换 KEY / 重新注入：清掉旧 SDK，避免新 KEY 被旧实例吞掉
        try { delete window.AMap } catch (e) { window.AMap = undefined }
        window.__whbisAmapKey = key
        const script = document.createElement('script')
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey)}&plugin=AMap.LineSearch`
        script.async = true
        script.onerror = () => { this._amapInject = null; reject(new Error('AMap 脚本加载失败')) }
        document.head.appendChild(script)
        check()
      })
      this._amapInject = { key, promise }
      return promise
    },
    async planRouteViaAmapKey() {
      if (this.useMap) return false
      const key = getAmapKey()
      if (!key) return false
      try {
        const AMap = await this.loadAmapJsApi(key)
        const official = await this.fetchOfficialLines(AMap)
        let ok = false
        for (const dir of [0, 1]) {
          if (official[dir] && official[dir].length > 1) {
            this.routeByDir[dir] = official[dir]
            this.routeState[dir] = 'ok'
            this.amapOfficial[dir] = true
            ok = true
          }
        }
        if (ok) this.renderSchematic()
        return ok
      } catch (e) {
        return false
      }
    },
    // 无 Key 模式走向吸附：OSRM 免 Key 公共路由，按线路-方向缓存 7 天；失败保持站点连线。
    // 资产已贴路的方向跳过（0 请求）；资产只有「干净站点连线」的方向后台补算，成功即平滑替换，
    // 不把已有实线切成 loading 虚线，避免闪烁。
    async planRouteViaOsrm() {
      if (this.useMap) return
      const DIRS = [0, 1]
      const todo = DIRS.filter((dir) =>
        !this.assetSnapped[dir] && !this.amapOfficial[dir] && cleanStops(this.stopsByDir[dir] || []).stops.length > 1
      )
      if (!todo.length) return
      todo.forEach((dir) => {
        if (!this.routeByDir[dir] || this.routeByDir[dir].length < 2) this.routeState[dir] = 'loading'
      })
      this.renderSchematic()
      for (const dir of todo) {
        const stops = pointsOf(cleanStops(this.stopsByDir[dir] || []).stops)
        try {
          const res = await fetchRoadRoute(stops, `${this.lineNo}-${dir}`)
          // fetchRoadRoute 返回 { points, stats }，须取 .points（历史 bug：当数组用导致补算永远不生效）
          const pts = Array.isArray(res) ? res : (res && res.points)
          // 等待期间高德官方轨迹可能已就位：此时不再用 OSRM 结果覆盖更精确的轨迹
          if (this.amapOfficial[dir]) continue
          if (pts && pts.length > 1) {
            this.routeByDir[dir] = pts
            this.routeState[dir] = 'ok'
            this.assetSnapped[dir] = true // 本会话内不再重复请求
            this.renderSchematic()
          } else if (!this.routeByDir[dir] || this.routeByDir[dir].length < 2) {
            this.routeState[dir] = 'fail'
          }
        } catch (e) {
          if (!this.routeByDir[dir] || this.routeByDir[dir].length < 2) this.routeState[dir] = 'fail'
        }
      }
      this.renderSchematic()
    },
    toggleBaseMap() {
      this.showBaseMap = !this.showBaseMap
      this.renderSchematic()
    },
    // 按相机算出当前视口需要的底图瓦片（XYZ 编号，256px/张）
    // 使用高德免 Key 标准瓦片（GCJ-02 栅格，与公交接口坐标同源，覆盖层无需纠偏）。
    renderTiles() {
      if (!this.showBaseMap) {
        if (this.tiles.length) this.tiles = []
        this._tileSig = '' // 关底图时清签名，再开启时一定重新赋值
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
          // 子域轮换分散请求；高德用标准 slippy（自下而上）
          const sub = Math.abs(tx + ty) % 4
          const url = `https://webrd0${sub + 1}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${wx}&y=${ty}&z=${zt}`
          out.push({
            key: `${zt}/${tx}/${ty}`,
            url,
            left: Math.round(left),
            top: Math.round(top),
            size: Math.ceil(size) + 1,
          })
        }
      }
      const next = out.slice(0, 120)
      // 微小平移/缩放时瓦片像素坐标（已 round）常常不变。若内容签名与上一帧相同，
      // 保留旧数组引用，避免 Vue 每帧 diff / 重建全部 <image> 节点（流畅度主因之一）。
      const sig = next.map((t) => `${t.key}@${t.left},${t.top},${t.size}`).join('|')
      if (sig !== this._tileSig) {
        this._tileSig = sig
        this.tiles = next
      }
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
          // 高德按线名搜索可能返回同名/近似线，必须校验轨迹是否与本线站点吻合，
          // 否则会把 K524 之类画成另一条线的走向（完全偏离）。吻合判定：平均偏离 <900m 且
          // 远离轨迹(>1.5km)的站点占比 <25%；不吻合则丢弃，回退资产/站点连线。
          const meters = (lat1, lng1, lat2, lng2) => {
            const R = 6371000, r = (d) => (d * Math.PI) / 180
            const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1)
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
          }
          const routeMatchesStops = (pts, stops) => {
            if (!pts.length || !stops.length) return false
            let sum = 0, far = 0, n = 0
            for (const s of stops) {
              const la = parseFloat(s.latitude), ln = parseFloat(s.longitude)
              if (isNaN(la) || isNaN(ln)) continue
              n++
              let best = Infinity
              for (const p of pts) { const dd = meters(la, ln, p.latitude, p.longitude); if (dd < best) best = dd }
              sum += best; if (best > 1500) far++
            }
            if (!n) return false
            return sum / n < 900 && far < n * 0.25
          }
          bumpAmapUsage() // 本机日用量 +1（仅统计，不影响高德账号实际账单）
          ls.search(this.lineName, (status, result) => {
            if (status !== 'complete') {
              // KEY 无效 / 类型不匹配（Web服务 Key 用在 JS API 会返回 USERKEY_PLAT_NOMATCH）时
              // 高德只回调 error，不给具体原因；这里给出明确可操作的提示，避免「配了没反应」。
              if (getAmapKey()) {
                uni.showToast({ title: '高德 KEY 未生效：需「Web端(JS API)」类型 Key', icon: 'none', duration: 3000 })
              }
              return done()
            }
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
              const pts = (line.path || []).map(toXY)
                .map((xy) => ({ latitude: xy.lat, longitude: xy.lng }))
                .filter((p) => !isNaN(p.latitude) && !isNaN(p.longitude))
              // 校验：与本站点的贴合度太差 → 判定为同名错线，丢弃（回退资产/站点路线）
              out[dir] = routeMatchesStops(pts, this.stopsByDir[dir]) ? pts : []
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
      // 非集团线路来自高德静态数据：没有实时车辆接口，跳过无意义的 /detailData 请求。
      // 站点与走向已由 loadAllStops 从公司分片资产加载。
      if (this.isForeignLine) {
        this.busesByDir = { 0: [], 1: [] }
        this.loading = false
        return
      }
      this.loading = true
      // 先清空上一批车辆，让地图移除旧标记，避免旧位置气泡残留叠加
      this.busesByDir = { 0: [], 1: [] }
      if (!silent) this.selectedBus = null
      await this.$nextTick()
      try {
        const [up, down] = await Promise.all([this.fetchDirLive(0), this.fetchDirLive(1)])
        // 用上一帧位置 + 当前线路 polyline 估算每辆车的朝向（上行/下行）。
        // 原先方向全靠后端 dir 字段，遇到环线或 GPS heading 与线路走向不一致时容易翻；
        // 本算法在 60° 容差内判定同向/反向，置信度低于阈值（0.3）的保持原 dir。
        const prev = this.prevBusesByDir || { 0: [], 1: [] }
        const estBuses = (dir) => {
          const arr = (up && dir === 0 ? up : down) || []
          const polyline = this.routeByDir[dir] || []
          return arr.map((b, i) => {
            const pb = (prev[dir] || [])[i]
            const res = polyline.length >= 3
              ? estimateDirection(b, pb, polyline)
              : { direction: null, confidence: 0 }
            if (res.direction !== null && res.confidence >= 0.3) {
              return { ...b, _estDir: res.direction, _estConf: res.confidence }
            }
            return { ...b, _estDir: b.dir, _estConf: 0 }
          })
        }
        this.busesByDir = { 0: estBuses(0), 1: estBuses(1) }
        this.prevBusesByDir = { 0: [...(up || [])], 1: [...(down || [])] }
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
    // —— 刷新间隔：全站唯一真源 ——
    loadRefreshPref() {
      this.refreshSec = getRefreshSec()
    },
    // 统一真源变化回调：本视图下拉 / 实时线路 / 极简站牌 / 设置面板任一处改动都会广播到这里
    applyRefreshSec(sec) {
      if (sec === this.refreshSec) return
      this.refreshSec = sec
      this.restartAutoRefresh()
      if (sec > 0 && !this.loading) this.loadLive(true)
    },
    // 兼容宿主 fire() 的历史转发入口
    onGlobalRefresh(sec) {
      this.applyRefreshSec(sec)
    },
    // 高德 KEY 变更（设置面板）即时跟随：重置官方轨迹标记后按当前线路重规划。
    // 清空 KEY 时已有官方轨迹需退回 OSRM/资产；有 KEY 时重新注入（KEY 可能换了）。
    onAmapKeyChange() {
      if (this.useMap || !this.lineNo) return
      this.amapOfficial = { 0: false, 1: false }
      this._amapInject = null
      // 清空 KEY 时把已贴路的方向重新交给 OSRM；有 KEY 时高德轨迹并行覆盖
      const key = getAmapKey()
      if (!key) this.assetSnapped = { 0: false, 1: false }
      this.planRouteViaOsrm()
      if (key) this.planRouteViaAmapKey()
      else this.renderSchematic()
    },
    // 底部栏「重扫」：线路态 = 刷新线路，全市态 = 重扫全网（复用 ctrl-city-row 的 runCity / cancelCity）
    bottomRescan() {
      if (this.cityOn) {
        if (this.cityBusy) this.cancelCity()
        else this.runCity(true)
      } else {
        this.refreshNow()
      }
    },
    // 单击 ↻：立即拉一次（自动刷新模式下也用于手动补一次）
    refreshNow() {
      if (this.loading) return
      this.loadLive()
    },
    // 选择刷新间隔：写入全站唯一真源，由广播驱动地图页 + 其余所有刷新控件
    setRefreshSec(sec) {
      this.closeRefreshMenu()
      if (sec === this.refreshSec) {
        this.restartAutoRefresh()
        return
      }
      saveRefreshSec(sec)
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
      // 常驻查车窗：恢复的输入立即重算结果，不必等用户再敲一次
      if (this.orgSearchInput) this.doOrgSearch()
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
      // 不重置 rankOpen：切出全市态只是把浮窗藏起来（v-if 带 cityOn），
      // 回到全市态要自动复现；只有浮窗右上角 ✕ 才会真正关闭
      this.cityDots = []
      this.cityNetPaths = []
      this.cityTags = []
      this.cityFilterNo = ''
      this.cityHitLine = null
      this.selectedBus = null
      // 回到线路视图：清掉全市视野与"用户已移动"标记，重新量占位并自适应整条线
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
        if (t !== '' && t != null) this.cityTagMode = Number(t)
        const nm = uni.getStorageSync(CITY_NET_MODE_KEY)
        if (CITY_NET_MODES.includes(nm)) this.cityNetMode = nm
      } catch (e) { /* 存储不可用保持默认 */ }
    },
    // 线网显示模式循环：精简（默认，只突出主干）→ 全部（逐条）→ 关闭 → 精简
    cycleCityNetMode() {
      const i = CITY_NET_MODES.indexOf(this.cityNetMode)
      this.cityNetMode = CITY_NET_MODES[(i + 1) % CITY_NET_MODES.length]
      try { uni.setStorageSync(CITY_NET_MODE_KEY, this.cityNetMode) } catch (e) { /* 忽略 */ }
      // 原生模式重建折线覆盖物；自绘模式重画线网
      if (this.useMap) this.mapKey++
      else this.renderCityNet(zoomScale(this.cam.zoom), this.canvas.w, this.canvas.h)
      uni.showToast({ title: this.cityNetModeLabel, icon: 'none' })
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
    // 全市线网走向（自绘模式）。三种模式：
    //   off   —— 只画车点，不画线网（车流分布看得最清楚）
    //   lite  —— 默认：淡色全网纹理打底 + 只突出站点多的主干线（上限 90 条），层次分明不再糊成一团
    //   full  —— 旧行为：视野内每条线逐条加重（最多 260 条），线路多时会密，供需要逐条辨认时用
    // 命中线路号筛选时一律逐条加重该线，避免单条走向被背景纹理漫掉。
    renderCityNet(s, w, h) {
      const net = this._net
      if (!net || this.cityNetMode === 'off') {
        this.cityNetPaths = []
        return
      }
      const rect = this._cityRect(w, h)
      const q = String(this.cityFilterNo || '').trim()
      const filtered = !!q
      const fuse = this.cam.zoom < CITY_NET_FUSE_ZOOM
      // lite：视野内主干优先（按站数），full：上限放宽到 260
      const modeCap = filtered ? CITY_NET_MAX_PATHS : (this.cityNetMode === 'lite' ? CITY_NET_LITE_PATHS : CITY_NET_MAX_PATHS)
      const allDirs = this.pickCityDirs(rect, Math.max(modeCap, fuse ? net.dirCount : 0))
      // 精简模式：分「背景纹理」与「主干突出」两层。
      //   背景 = 未被选中的线，合并成两条极淡巨路径（保留网络形状，不抢视线）；
      //   主干 = 站数最多的前 modeCap 条，逐条正常描边。
      let detailDirs = allDirs
      let bgDirs = []
      if (this.cityNetMode === 'lite' && !filtered && allDirs.length > modeCap) {
        const byN = [...allDirs].sort((a, b) => b.n - a.n)
        detailDirs = byN.slice(0, modeCap)
        const picked = new Set(detailDirs)
        bgDirs = allDirs.filter((d) => !picked.has(d))
      }
      // 点预算按真正逐条绘制的线计算（背景层单独拼、也吃总量，一并计入）
      let total = 0
      for (const d of detailDirs) total += d.n
      for (const d of bgDirs) total += d.n
      const step = total > CITY_NET_MAX_PTS ? Math.ceil(total / CITY_NET_MAX_PTS) : 1
      const cu = this.cam.u
      const cv = this.cam.v
      const cx = this.projCenter.x
      const cy = this.projCenter.y
      // 热点：上千条线 × 上万点逐帧拼 SVG path。Math.round 数值拼接比 toFixed(1) 的字符串
      // 格式化更快（两者都是 0.1px 精度），是拖动卡顿的主因之一。
      const r1 = (v) => Math.round(v * 10) / 10
      // 按 parts（[from,to] 索引对）分段画：跨站跳变（飞线）处断开，每段各自 M 起笔，不跨段硬连
      const pathOf = (d) => {
        const parts = d.parts || [[0, d.n - 1]]
        const seg = []
        for (const [from, to] of parts) {
          if (to - from < 1) continue
          let first = true
          for (let i = from; i <= to; i += step) {
            const x = r1((d.mu[i] - cu) * s + cx)
            const y = r1((d.mv[i] - cv) * s + cy)
            seg.push((first ? 'M' : 'L') + x + ' ' + y)
            first = false
          }
          if ((to - from) % step !== 0) {
            const x = r1((d.mu[to] - cu) * s + cx)
            const y = r1((d.mv[to] - cv) * s + cy)
            seg.push('L' + x + ' ' + y)
          }
        }
        return seg.join('')
      }
      const paths = []
      // ① 背景纹理层（淡、细、先画）：远景合并全部、近景只合并非主干；完全不抢视线
      const bgPool = bgDirs.length ? bgDirs : (fuse && !filtered ? allDirs : [])
      if (bgPool.length) {
        const buf = [[], []]
        for (const d of bgPool) buf[d.dir].push(pathOf(d))
        for (const dir of [1, 0]) {
          if (!buf[dir].length) continue
          paths.push({ key: 'fuse' + dir, d: buf[dir].join(''), color: DIR_STYLE[dir].svgStroke, w: 1.2, op: 0.22 })
        }
      }
      // ② 主干 / 逐条层：lite 用中等粗细+较高透明度，full/filtered 用旧口径（w4）
      // lite 模式任何缩放都画主干（上限 90 条），否则远景只剩淡纹理→看起来「有站没线连」；
      // full 模式远景仍只保留淡纹理（1000+ 条 w4 会糊屏且白画一遍）。
      const drawIndividual = filtered || !fuse || this.cityNetMode === 'lite'
      if (drawIndividual) {
        const lineW = this.cityNetMode === 'lite' && !filtered ? 2.6 : 4
        const lineOp = this.cityNetMode === 'lite' && !filtered ? 0.85 : 1
        for (const d of detailDirs) {
          if (d.n < 2) continue
          if (d.suspect) {
            // 坐标可疑（2 点跨城 / 全跳变）：极淡虚线提示「这条线存在但坐标不可信」，不画成实飞线
            paths.push({ key: d.code + '-' + d.dir, d: pathOf(d), color: DIR_STYLE[d.dir].svgStroke, w: 1.2, op: 0.3, dash: '3 4' })
          } else {
            paths.push({ key: d.code + '-' + d.dir, d: pathOf(d), color: DIR_STYLE[d.dir].svgStroke, w: lineW, op: lineOp })
          }
        }
      }
      this.cityNetPaths = paths
    },
    // 自编号标签（自绘模式）：只在近景出现，并做像素级避让，数量封顶。
    // mode 0=关闭 1=仅自编号 2=自编号+线路号（337 · 319N2379）
    buildCityTags(dots) {
      if (!this.cityTagMode) return []
      if (this.cam.zoom < CITY_TAG_MIN_ZOOM) return []
      const cands = dots.filter((d) => d.bus && d.bus.orgId)
      // 选中/刚定位的车优先占位，其余按速度档高到低（快车的自编号更有意义）
      cands.sort((a, b) => (this._tagPri(b.bus) - this._tagPri(a.bus)) || (b.bus.band - a.bus.band))
      const taken = []
      const out = []
      for (const d of cands) {
        if (out.length >= CITY_TAG_MAX) break
        const org = this.fmtNo(d.bus.orgId)
        const dirTxt = d.bus.dir === 0 ? '上行' : '下行'
        const text = this.cityTagMode === 2 ? `${d.bus.no || ''} · ${org} · ${dirTxt}` : org
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
      this.cityTagMode = (this.cityTagMode + 1) % 3
      try {
        uni.setStorageSync('whbis:city-tags', this.cityTagMode)
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
      // 常驻查车窗：快照刷新后按当前输入重算（首屏恢复的输入此时才有数据可匹配）
      if (this.orgSearchInput) this.doOrgSearch()
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
      const showTag = this.cityTagMode > 0 && scale >= CITY_TAG_MIN_SCALE
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
            iconPath: assetUrl(`/static/img/bus-city-${c.bus.band}.png`),
            width: 15,
            height: 15,
          }
          if (showTag && tagCount < CITY_TAG_MAX && c.bus.orgId) {
            tagCount++
            const org = this.fmtNo(c.bus.orgId)
            const dirTxt = c.bus.dir === 0 ? '上行' : '下行'
            const labelContent = this.cityTagMode === 2 ? `${c.bus.no || ''} · ${org} · ${dirTxt}` : org
            marker.label = {
              content: labelContent,
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
            iconPath: assetUrl('/static/img/bus-city-cluster.png'),
            width: 30,
            height: 30,
            label: {
              content: String(c.n),
              color: '#FFFFFF',
              fontSize: 11,
              fontWeight: 'bold',
              borderRadius: 12,
              bgColor: accentRgba(0.92), // 聚合数字标签底色跟随主题色（marker 吃不到 CSS 变量）
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
    // 通查（顶栏搜索是全站唯一查询入口，宿主在全市态把 pick 转交到这里）：
    // ① 线路号命中线网 → 收景到那条线（只绘它的两个方向）；
    // ② 底图无几何但快照里有它的车 → 退化成「只筛车」；
    // ③ 线路维度全空 → 再按车辆自编号在快照里找车（正向 MD5，无需编号字典）；
    // ④ 全空才报未命中。一框通吃线路号与自编号（3240 这类自编号不是线路号）
    cityFilterByNo(raw) {
      raw = String(raw == null ? '' : raw).trim()
      if (!raw) {
        uni.showToast({ title: '请输入线路号或车辆自编号', icon: 'none' })
        return
      }
      const hit = netSearchLines(raw, 1)[0] || null
      if (!hit) {
        const inSnap = this.cityBuses.some((b) => String(b.no).includes(raw) || String(b.code) === raw)
        if (!inSnap) {
          const b = findBusByOrgId(raw, this.cityBuses)
          if (!b) {
            uni.showToast({ title: `线网与在运车辆里都没有「${raw}」`, icon: 'none' })
            this.clearCityQuery()
            return
          }
          // 筛选会把它藏起来，先整组清掉再定位
          this.cityFilterNo = ''
          this.cityHitLine = null
          this.selectBus(b)
          this.focusBus(b)
          uni.showToast({ title: `自编号 ${b.orgId || raw} · ${b.no} 路（${b.dir === 0 ? '上行' : '下行'}）已定位`, icon: 'none' })
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
      this.cityHitLine = hit
      this.cityFilterNo = hit.no
      this.selectedBus = null
      this._applyCityFilter(true)
      uni.showToast({ title: `${hit.no} 路 · ${hit.dirs.length} 个方向 · 已定位走向`, icon: 'none' })
    },
    // 清除线路筛选，看回全市（不动视野：用户可能正盯着某个角落）
    clearCityQuery() {
      if (!this.cityFilterNo && !this.cityHitLine) return
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
    // 从一辆车跳到它所属的线路（交给宿主换线，同时退出全市图层）；fromCity 标记 = 全市内部
    // 的「打开线路」出口，宿主在全市态收到它仍走换线，而不是当成顶栏查询转交筛选
    openCityLine(bus) {
      if (!bus || !bus.code) return
      this.exitCity()
      this.$emit('pick-line', {
        lineCode: buildLineCode(bus.code, bus.dir),
        lineName: bus.no || bus.code,
        direction: Number(bus.dir || 0),
        startStop: '',
        endStop: '',
        fromCity: true,
      })
    },
    // 「已筛选」芯片点击：把当前筛选的线路正式打开（退出全市 → 宿主换线）；✕ 才是看回全市
    openFilteredLine() {
      const no = String(this.cityFilterNo || '').trim()
      if (!no) return
      // 优先用线网命中的真实 lineCode（电1 的 code 是 1001 这类），快照兜底，最后才按号码拼
      let code = this.cityHitLine && this.cityHitLine.code
      if (!code) {
        const b =
          this.cityBuses.find((x) => String(x.no) === no) ||
          this.cityBuses.find((x) => String(x.no).includes(no))
        code = b && b.code
      }
      if (!code) code = buildLineCode(no, 0)
      this.exitCity()
      this.$emit('pick-line', {
        lineCode: code,
        lineName: no,
        direction: 0,
        startStop: '',
        endStop: '',
        fromCity: true,
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
    // 面板自由缩放（仅 H5/桌面）：给控制卡 / 右侧栏 / 车辆卡 / 时刻表卡挂拖拽手柄，
    // 尺寸记忆在 localStorage（键见 panelResize.js），双击手柄复位。
    // 幂等：同一 DOM 节点只挂一次（__rs 标记）；面板随 v-if 重建出的新节点在下次 measureUi 时补挂。
    setupPanelResize() {
      if (typeof document === 'undefined' || typeof window === 'undefined') return
      const vh = window.innerHeight || 800
      // 左侧控制卡（.ctrl）高度固定、由 CSS 自然贴合内容，**不接可缩放手柄**：
      // 用户曾拖出虚高记忆 → 面板底部留大片空白；且顶栏是卡内首块，拉高只会压缩地图可视区。
      // 清掉历史记忆键 + 可能残留的内联高度 / 手柄 DOM（从旧版升级上来的页面样式仍生效），
      // 让卡片回到 CSS 自然高度。右侧车辆卡 / 时刻表卡仍开放调高度（maxHeight + 内部列表滚动）。
      try {
        uni.removeStorageSync('whbis:panel-size:v1:ctrl')
        const ctrlEl = document.querySelector('.ctrl')
        if (ctrlEl) {
          ctrlEl.style.height = ''
          ctrlEl.style.overflow = ''
          const oldGrip = ctrlEl.querySelector('.rs-grip')
          if (oldGrip) oldGrip.remove()
          ctrlEl.__rs = null
          if (ctrlEl.__ro) { ctrlEl.__ro.disconnect(); ctrlEl.__ro = null }
        }
      } catch (e) { /* 存储不可用忽略 */ }
      const specs = [
        { sel: '.panel', opts: { key: 'panel', axis: 'y', edge: 'bottom', heightProp: 'maxHeight', minH: 120, maxH: vh - 48, onResize: () => this.scheduleMeasure() } },
        { sel: '.plan-side', opts: { key: 'plan', axis: 'y', edge: 'bottom', heightProp: 'maxHeight', minH: 120, maxH: vh - 48, onResize: () => this.scheduleMeasure() } },
      ]
      specs.forEach((sp) => {
        const el = document.querySelector(sp.sel)
        if (!el) return
        // 节点已挂手柄时只需再校正一次高度：单线路/全市切换后内容变高，
        // 记忆里较小的旧高度要把卡片撑到内容高，否则底部按钮会溢到卡片外
        if (el.__rs) {
          if (el.__rs.refit) el.__rs.refit()
        } else {
          el.__rs = createResizable(el, sp.opts)
          ;(this._resizers || (this._resizers = [])).push(el.__rs)
        }
      })
    },
    // 量取控制卡 / 右侧栏（车辆面板 + 时刻表面板）/ 图例实际占位（此项目样式用 rpx，不能用固定 px 推算）
    // 面板拖动 / 多 watcher 同帧触发时会连续多次 measureUi，每次都是 6 个 boundingClientRect
    // （强制 layout）。合并到每帧一次：拖动跟手由 panelResize 自己写 style，量测延后一帧无感。
    scheduleMeasure() {
      if (this._measureRaf) return
      const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
        ? (cb) => window.requestAnimationFrame(cb)
        : (cb) => setTimeout(cb, 16)
      this._measureRaf = raf(() => {
        this._measureRaf = null
        this.measureUi()
      })
    },
    measureUi() {
      const q = uni.createSelectorQuery().in(this)
      q.select('.ctrl').boundingClientRect()
      q.select('.side-col').boundingClientRect()
      q.select('.schematic-legend').boundingClientRect()
      q.select('.schematic').boundingClientRect()
      q.select('.city-legend').boundingClientRect()
      q.select('.rank-card').boundingClientRect()
      q.exec((res) => {
        const arr = res || []
        const prevCtrl = this.uiRects.ctrl
        const prevSide = this.uiRects.side
        const prevRank = this.uiRects.rank
        this.uiRects = {
          ctrl: arr[0] || null,
          side: arr[1] || null,
          legend: arr[2] || arr[4] || null,
          rank: arr[5] || null,
        }
        // H5 有原生标题栏（--window-top），窗口高度不等于画布高度，以实际画布矩形为准
        const box = arr[3]
        const prevCanvas = this.canvas
        if (box && box.width && box.height) {
          this.canvas = { w: Math.round(box.width), h: Math.round(box.height) }
        }
        // 控制卡/面板高度会随异步数据（营运公司徽章、车辆数）变化，画布也可能因窗口缩放变化；
        // 占位变了就得重排，但用户已手动平移/缩放时保持其视角不动
        const changed = (prev, now) => !!(prev && now && Math.abs(now.bottom - prev.bottom) > 8)
        // 榜单从无到有/从有到无会吃掉右侧整块绘制区，必须重排（changed 只比较都有值的情况）
        const rankToggled = !!prevRank !== !!this.uiRects.rank
        const grew = changed(prevCtrl, this.uiRects.ctrl) || changed(prevSide, this.uiRects.side) ||
          rankToggled || changed(prevRank, this.uiRects.rank)
        const resized = prevCanvas.w !== this.canvas.w || prevCanvas.h !== this.canvas.h
        if (!this.camInited || ((grew || resized) && !this._userMoved)) this.fitRoute()
        else this.renderSchematic()
        // 面板可能刚随 v-if 出现（如切离全市态出侧栏、载入线路出时刻表卡）→ 补挂缩放手柄
        this.setupPanelResize()
      })
    },
    // 可绘制矩形：避开左上控制卡、右侧栏 / 车速榜浮窗（桌面）/ 底部横栏（手机）、底部图例
    fitRect() {
      const { w, h } = this.canvas
      const c = this.uiRects.ctrl
      // 折叠时榜单只剩标题一条，不再占用右侧绘制区（收起前那一大片要避让）
      const p = this.uiRects.side || (this.rankFolded ? null : this.uiRects.rank)
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
      // 全市态下"全览"览的是车点包围盒，不能拿本线站点把视野拽回去
      if (this.cityOn) { this.fitCity(); return }
      const pts = []
      ;[0, 1].forEach((d) => {
        ;(this.stopsByDir[d] || []).forEach((st) => {
          const lat = parseFloat(st.latitude)
          const lng = parseFloat(st.longitude)
          if (!isNaN(lat) && !isNaN(lng)) pts.push({ lat, lng })
        })
        // 贴路几何会绕出站点包围盒（真实绕行 / 掉头），只按站点算视野会把这些段挤到边缘甚至裁掉
        ;(this.routeByDir[d] || []).forEach((p) => {
          const lat = parseFloat(p.latitude)
          const lng = parseFloat(p.longitude)
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
      // 全览：清掉"用户已调整视角"标记并重新自适应（全市态下览的是车点包围盒）
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
      this.scheduleRender()
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
      if (!el) return
      // 仿真站牌模式：站牌层自己滚动，不绑定地图手势（拖动 / 滚轮 / 触摸都不接管）
      if (this.simSignboard) {
        this.unbindGestures()
        el.style.touchAction = 'auto'
        return
      }
      if (this._boundEl === el) return
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
      this.scheduleRender()
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
      const st = (this.stopsByDir[s.dir] || [])[s.idx]
      if (!st) return
      this.selectStop({ name: st.stopName, dir: s.dir, lat: parseFloat(st.latitude), lng: parseFloat(st.longitude) })
    },
    // 站名标签（HTML 叠加层）点击：与站点圆点同走站点详情窗
    onStopLabelTap(s) {
      if (this._suppressClick) return
      const st = (this.stopsByDir[s.dir] || [])[s.idx]
      if (!st) return
      this.selectStop({ name: st.stopName, dir: s.dir, lat: parseFloat(st.latitude), lng: parseFloat(st.longitude) })
    },
    // 高频交互（拖拽 / 滚轮 / 双指）合并到每帧一次重绘：touchmove/wheel 一秒可触发几十次，
    // 而全市态每次重绘要投影上千条线 + 全部车点，同步逐事件跑会明显掉帧。
    // 用 rAF 把同一帧内的多次请求折叠为一次；离散状态变化仍直接调 renderSchematic。
    scheduleRender() {
      if (this._raf) return
      const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
        ? (cb) => window.requestAnimationFrame(cb)
        : (cb) => setTimeout(cb, 16)
      this._raf = raf(() => {
        this._raf = null
        this.renderSchematic()
      })
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
      // 双方向同屏且几何同向重合时，给 dir1 反向偏移（见 routeSameDirection 注释）
      const sameDir = dirs.length > 1 && this.routeSameDirection()
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
        const hasRoute = this.routeByDir[d] && this.routeByDir[d].length > 1
        const src = hasRoute
          ? this.routeByDir[d].map((p) => ({ lat: p.latitude, lng: p.longitude }))
          : (this.stopsByDir[d] || []).map((st) => ({ lat: parseFloat(st.latitude), lng: parseFloat(st.longitude) }))
        // 走向几何端点常与首末站有数百米偏差（高德只画到路口 / 桥尾，离真实站点尚远），
        // 把首末站真实坐标补到走向两端，保证连线真正接上起终点。
        // 几何端点与任一首尾站都离得很远（改线后资产陈旧 / 点序错乱）时跳过锚定，
        // 否则强接会拉出横跨全线的 V 形长直线（站点圆点正常但线绕远）。
        const stopsArr = this.stopsByDir[d] || []
        if (hasRoute && stopsArr.length >= 2) {
          const toPt = (st) => ({ lat: parseFloat(st.latitude), lng: parseFloat(st.longitude) })
          const first = toPt(stopsArr[0])
          const last = toPt(stopsArr[stopsArr.length - 1])
          const g0 = src[0]
          const gEnd = src[src.length - 1]
          const dist2 = (a, b) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2
          // 约 2km 的经纬度平方距离阈值（武汉纬度 30.6°：0.02°≈2.2km）
          const MAX_ANCHOR_D2 = 0.0004
          const d0f = dist2(g0, first), d0l = dist2(g0, last)
          const dEf = dist2(gEnd, first), dEl = dist2(gEnd, last)
          // 两端各自就近配对到不同终点时才能锚定（头配首站则尾配尾站，反之亦然）；
          // 只要有一端离所有终点都很远，或两端都挤向同一终点，就放弃锚定。
          const endIsLast = dEl <= dEf
          const nearHead = Math.min(d0f, d0l) <= MAX_ANCHOR_D2
          const nearTail = Math.min(dEf, dEl) <= MAX_ANCHOR_D2
          const headIsFirst = d0f <= d0l
          if (nearHead && nearTail && headIsFirst === endIsLast) {
            const head = headIsFirst ? first : last
            const tail = headIsFirst ? last : first
            src.unshift(head)
            src.push(tail)
          }
        }
        const raw = src.filter((p) => !isNaN(p.lat) && !isNaN(p.lng)).map((p) => ({ x: sx(p.lng), y: sy(p.lat) }))
        // 同向重合时 dir1 反向偏移，保证两条线分居两侧都能看见
        const off = (sameDir && d === 1) ? -trackOff : trackOff
        return sideShift(raw, off)
      }

      // 1) 走向线（轨迹点过多时抽样，避免路径字符串过长拖慢渲染）+ 方向箭头
      const routes = []
      const arrows = []
      // 每个方向「实际画出来的」屏幕点序列，供下面站点圆点吸附，保证圆点落在线上
      const routePts = {}
      dirs.forEach((d) => {
        const pts = ptsOf(d)
        if (pts.length < 2) return
        const step = pts.length > 400 ? Math.ceil(pts.length / 400) : 1
        const sampled = step > 1 ? pts.filter((p, i) => i % step === 0).concat([pts[pts.length - 1]]) : pts
        routePts[d] = sampled
        // 未贴路（计算中/失败）时画细虚线 + 半透明：明确告诉用户这是站间直连估算，不是真实走向
        // 贴路后两个方向靠颜色 + 横向偏移区分，不再用虚线（双轨并排比虚线更好读）
        const snapped = !!(this.routeByDir[d] && this.routeByDir[d].length > 1)
        routes.push({
          dir: d,
          color: this.routeStyle(d).svgStroke,
          dash: snapped ? 'none' : '3 6',
          w: snapped ? 4.5 : 3,
          op: snapped ? 1 : 0.55,
          d: smoothPath(sampled, snapped),
        })
      })
      this.svgRoutes = routes

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
      const usedBoxes = []
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
          // 站点圆点吸附到本方向实际绘制的走向线（含分轨偏移 / 贴路几何），
          // 消除「站点所在位置与线路走向错开」；距离超限时保留原始投影点
          const rawX = sx(lng)
          const rawY = sy(lat)
          const onRoute = snapToRoute(routePts[d], rawX, rawY)
          const x = onRoute ? onRoute.x : rawX
          const y = onRoute ? onRoute.y : rawY
          const isFirst = i === 0
          const isLast = i === arr.length - 1
          const terminal = isFirst || isLast
          // 起点=绿 / 终点=琥珀，与方向色（青 / 玫红）区分，明确"起""终"
          const END_COLOR = { first: '#22c55e', last: '#f59e0b' }
          const endKind = isFirst ? 'first' : isLast ? 'last' : ''
          const endTag = isFirst ? '起' : isLast ? '终' : ''
          const color = !terminal ? this.routeStyle(d).svgStroke : END_COLOR[endKind]
          stops.push({
            dir: d,
            idx: i,
            name: st.stopName,
            x,
            y,
            terminal,
            endKind,
            endTag,
            color,
          })
          // 放到极小时才隐藏中间站名（如手动缩到全城尺度）。旧版宽屏门槛 13 太高：
          // 长线路自适应全览的 zoom 常落在 12 附近，中间站会被整批隐藏、只剩首末站两个。
          // 站名是否相撞已由下方 usedBoxes 文字框碰撞保证，这里只需挡住极端缩放。
          const zoomGate = w < 600 ? 8.5 : 9.5
          if (!this.showStopLabels || !(terminal || this.cam.zoom >= zoomGate)) return
          if (!terminal && stride > 1 && i % stride !== 0) return
          // 靠边时强制把文字放到画布内侧（先定方向，才能算出文字框做碰撞判定）
          let right = i % 2 === 0
          if (x < 110) right = true
          else if (x > w - 110) right = false
          // 与站点圆点（半径 6.5）留出 4px 间隙
          const lx = right ? x + 11 : x - 11
          const sw = textW((endTag ? endTag + '·' : '') + st.stopName)
          const nx1 = right ? lx : lx - sw
          const box = { x1: nx1, x2: nx1 + sw, y1: y - 6, y2: y + 6 }
          // 压在车辆圆点上就直接不放（首末站不因此丢弃，交由后面与车号文本框避让）
          const onDot = busPts.some(
            (p) => !(box.x2 <= p.x - 10 || p.x + 10 <= box.x1 || box.y2 <= p.y - 10 || p.y + 10 <= box.y1)
          )
          if (!terminal && onDot) return
          // 与已放站名做文字框相交判定（首末站例外，它们必须显示，后面还会上下微移）。
          // 旧版只看同侧 y 差 <17px：东西走向线路相邻站 y 几乎相同、x 相隔很远，
          // 名字根本不重叠却被误删，导致大量中间站只剩圆点没有名字。
          // 加 4px 容差：相邻站名虽不直接重叠但距离极近时也会互相干扰阅读。
          const MARGIN = 4
          const hitBox = usedBoxes.some(
            (bb) => !(box.x2 <= bb.x1 + MARGIN || bb.x2 <= box.x1 + MARGIN || box.y2 <= bb.y1 + MARGIN || bb.y2 <= box.y1 + MARGIN)
          )
          if (!terminal && hitBox) return
          usedBoxes.push(box)
          placedNames.push({ name: st.stopName, x, y })
          labels.push({
            dir: d,
            idx: i,
            name: st.stopName,
            terminal,
            endKind,
            endTag,
            anchor: right ? 'start' : 'end',
            lx,
            ly: y,
          })
        })
      })
      this.svgStops = stops
      this.labelStops = labels

      // 箭头位置：按屏幕像素间距等距放置（放大后自动变密），间隔 70px。
      // 放在站点算好之后：若箭头中心正落在任一站点圆点上就跳过，避免与站点标记重叠。
      const ARROW_SPACING = 70
      // 站点圆点半径（末站实心点约 9px）+ 箭头半宽（约 6px）→ 16px 内视为重叠
      const STOP_AVOID_R2 = 16 * 16
      dirs.forEach((d) => {
        const sampled = routePts[d]
        if (!sampled || sampled.length < 2) return
        let cumDist = 0
        for (let i = 0; i < sampled.length - 1; i++) {
          const a = sampled[i], b = sampled[i + 1]
          const segLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
          if (segLen < 1) continue
          // 在路段中点投放，但只在前一个箭头 ≥ ARROW_SPACING px 时才放
          if (cumDist > 0 && cumDist < ARROW_SPACING) { cumDist += segLen; continue }
          const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2
          // 箭头中心压在任一方向站点的圆点上（含对向站点）则跳过本箭头
          const onStop = stops.some((s) => (s.x - midX) ** 2 + (s.y - midY) ** 2 < STOP_AVOID_R2)
          if (!onStop) {
            const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
            arrows.push({ x: midX, y: midY, deg, color: this.routeStyle(d).svgStroke })
          }
          cumDist = 0
          // 累加本段后半程到下一个候选点的距离
          cumDist += segLen / 2
        }
      })
      this.routeArrows = arrows

      // 4) 车辆（圆点 + 已算好的车号位置）
      this.svgBuses = this.shownBuses.map((b, i) => {
        const p = busPts[i]
        const dirTxt = b.dir === 0 ? '上行' : '下行'
        return {
          key: b.dir + '-' + i,
          dir: b.dir,
          label: `${this.lineName || ''} · ${this.fmtNo(b.orgId || '')} · ${dirTxt}`,
          x: p.x,
          y: p.y,
          labelY: p.ly,
          // 靠边时调整标签对齐方式，避免车号被画布裁掉
          edge: p.x < 34 ? 'l' : (p.x > w - 34 ? 'r' : ''),
          color: this.routeStyle(b.dir).bus,
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
        color: c.bus ? SPEED_BANDS[c.bus.band].color : getAccent(), // 无车点兜底色跟随主题（canvas/SVG 用色须是真实色值）
        bus: c.bus || null,
        located: !!c.bus && this.locatedBus === c.bus,
      }))
      this.cityTags = this.buildCityTags(this.cityDots)
      this.gridLines = this.buildGrid(s, w, h)
    },
    // 原生地图的标记点击（单击 / 双击都可，双击就是连点两次）。
    // ⚠ uni-h5 的 markertap 是自定义事件：normalizeCustomEvent 只返回 { type, timeStamp, target, currentTarget, detail }，
    //   参数全在 e.detail 里——直接读 e.markerId 恒为 undefined，会让"点车图标"完全没反应。
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
        if (s) this.selectStop({ name: s.stopName, dir, lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) })
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
      this.selectedStop = null
      this.selectedBus = bus
      this.renderSchematic()
    },
    // 车速榜开关：开启态写本机，控制卡按钮与浮窗 ✕ 共用同一份状态
    toggleRank() {
      this.rankOpen = !this.rankOpen
      this.saveRankOpen()
    },
    // 浮窗右上角 ✕：记下关闭态，下次不常驻复现；位置本身仍保留
    closeRank() {
      this.rankOpen = false
      this.saveRankOpen()
    },
    saveRankOpen() {
      try { uni.setStorageSync(RANK_OPEN_KEY, this.rankOpen ? 1 : 0) } catch (e) { /* 存储不可用仅本次生效 */ }
    },
    // 车速榜拖动：移动即时更新位置；松手写盘，二次打开恢复到上次位置
    onRankMove(pos, phase) {
      this.rankPos = pos
      if (phase === 'end') writePanelPos(RANK_POS_KEY, pos)
    },
    // 榜单折叠：同步状态并重新量占位（折叠后高度骤变，全览要重排）
    onRankFold(v) {
      this.rankFolded = !!v
      this.$nextTick(() => this.measureUi())
    },
    // 车速榜点行：清掉线路筛选（否则目标车可能被筛掉），弹详情窗并精确居中定位
    onRankPick(bus) {
      if (!bus) return
      if (this.cityFilterNo) {
        this.cityFilterNo = ''
        this.cityHitLine = null
      }
      this.selectBus(bus)
      this.focusBus(bus)
    },

    // —— 自编号查车（按末尾数字跨公司模糊匹配全市快照，零请求）——
    toggleOrgSearch() {
      // 与车速榜可同时打开：两块面板上下错开，不再互斥
      this.orgSearchOpen = !this.orgSearchOpen
      this.saveOrgOpen()
      if (this.orgSearchOpen) {
        this.doOrgSearch()
        this.$nextTick(() => this.bindOrgDrag())
      }
      this.$nextTick(() => this.measureUi())
    },
    closeOrgSearch() {
      this.orgSearchOpen = false
      this.saveOrgOpen()
      this.$nextTick(() => this.measureUi())
    },
    saveOrgOpen() {
      try { uni.setStorageSync(ORG_OPEN_KEY, this.orgSearchOpen ? 1 : 0) } catch (e) { /* 忽略 */ }
    },
    // 自编号查车浮窗拖动：只绑标题栏 grip，松手写盘
    bindOrgDrag() {
      if (this._unbindOrgDrag) { this._unbindOrgDrag(); this._unbindOrgDrag = null }
      if (typeof document === 'undefined') return
      const panel = document.querySelector('.org-search')
      const grip = panel && panel.querySelector('.os-grip')
      if (!panel || !grip) return
      this._unbindOrgDrag = bindFloatDrag(grip, panel, (pos, phase) => {
        this.orgPos = pos
        if (phase === 'end') writePanelPos(ORG_POS_KEY, pos)
      })
    },
    // 输入即查：uni-app 的 input 事件在 H5 是 e.target.value、小程序是 e.detail.value
    onOrgInput(e) {
      const v = e && e.detail && e.detail.value != null
        ? e.detail.value
        : (e && e.target && e.target.value != null ? e.target.value : this.orgSearchInput)
      this.orgSearchInput = v
      try { uni.setStorageSync(ORG_INPUT_KEY, this.orgSearchInput) } catch (err) { /* 忽略 */ }
      this.doOrgSearch()
    },
    doOrgSearch() {
      const raw = String(this.orgSearchInput || '').trim()
      const { digits, buses } = searchBusesByOrgSuffix(raw, this.cityBuses, 2)
      this.orgQueryDigits = digits
      if (!raw) {
        this.orgResults = []
        this.orgSearchMsg = '输入自编号末尾数字，如 2426（后四位）或 426（后三位），跨所有公司匹配'
        return
      }
      if (digits.length < 2) {
        this.orgResults = []
        this.orgSearchMsg = '至少输入 2 位数字（后三位 / 后四位最常用）'
        return
      }
      if (!this.cityBuses.length) {
        this.orgResults = []
        this.orgSearchMsg = '当前没有全市快照，请先在控制卡点「↻ 重扫」'
        return
      }
      if (!buses.length) {
        this.orgResults = []
        this.orgSearchMsg = `快照（${this.cityBuses.length} 辆）里没有自编号尾号为「${digits}」的车；可试试更短的尾号（如后三位）`
        return
      }
      this.orgSearchMsg = ''
      // 展示用的轻量对象：复用车速榜同一套走向/公司口径
      this.orgResults = buses.map((bus) => {
        const rt = routeOf(bus.no, bus.dir)
        return {
          ...bus,
          routeText: rt.known ? rt.text : (bus.lineName || '走向未知'),
          company: orgCompanyOf(bus),
          stopName: this.nearestOrgStopName(bus),
        }
      })
      // 站点明细按线路异步加载并回填，复制时已就绪（富格式须在手势栈内同步写入，不能等）
      this.fillOrgStopNames(this.orgResults)
    },
    // 异步预取查车结果的站点明细：按线路号去重，in-flight Promise 防止输入即查反复请求。
    // 站点只存 {stopName, lat, lng}，结果行与复制共用 nearestOrgStopName 同步取最近站。
    async fillOrgStopNames(results) {
      if (!results || !results.length) return
      if (!this._orgStopLoading) this._orgStopLoading = {}
      const nos = [...new Set(results.map((b) => String(b.no)).filter(Boolean))]
      await Promise.all(nos.map(async (no) => {
        if (this.orgStopCache[no + '|0'] && this.orgStopCache[no + '|1']) return
        let p = this._orgStopLoading[no]
        if (!p) {
          p = (async () => {
            let row = null
            try { row = await loadLineAsset(no) } catch (e) { row = null }
            for (const d of [0, 1]) {
              const dirRow = row ? assetDir(row, d) : null
              const stops = (dirRow && dirRow.stops) || []
              this.orgStopCache[no + '|' + d] = stops
                .map((s) => ({
                  stopName: s.stopName || '',
                  latitude: parseFloat(s.latitude),
                  longitude: parseFloat(s.longitude),
                }))
                .filter((s) => !isNaN(s.latitude) && !isNaN(s.longitude))
            }
          })()
          this._orgStopLoading[no] = p
        }
        try { await p } finally { delete this._orgStopLoading[no] }
      }))
      // 回填到结果对象（仍用传入的 results，避免查询已切换时污染新结果）
      results.forEach((b) => { b.stopName = this.nearestOrgStopName(b) })
    },
    // 同步：按车辆 GPS 在已缓存的「该线路该方向」站点里找最近站名；无缓存返回空串
    nearestOrgStopName(bus) {
      if (!bus) return ''
      const stops = this.orgStopCache[String(bus.no) + '|' + bus.dir]
      if (!stops || !stops.length || isNaN(bus.lat) || isNaN(bus.lng)) return ''
      let best = '', bestD = Infinity
      for (const s of stops) {
        const d = distance(bus.lat, bus.lng, s.latitude, s.longitude)
        if (d < bestD) { bestD = d; best = s.stopName }
      }
      return best
    },
    // 复制查车结果：档位由 CopyPill 的全站设置决定（文字 / Excel / 图片）。
    // 全程同步（站点已由 fillOrgStopNames 预取到缓存），保证图片/Excel 的 ClipboardItem 在手势栈内写入。
    copyOrgResults() {
      if (!this.orgResults.length) {
        uni.showToast({ title: '暂无可复制的查车结果', icon: 'none' })
        return
      }
      const dirName = (d) => (d === 0 ? '上行' : d === 1 ? '下行' : '—')
      const rows = this.orgResults.map((r) => [
        r.no || '',
        r.company || '',
        (r.stopName || this.nearestOrgStopName(r)) || '—',
        r.orgId ? this.fmtNo(r.orgId) : '',
        dirName(r.dir),
      ])
      copyTable({
        title: `自编号查车 尾号 ${this.orgQueryDigits} · 命中 ${this.orgResults.length} 辆 · 快照 ${this.cityBuses.length} 辆`,
        columns: ['线路号', '营运公司', '所处站点', '自编号', '上下行'],
        rows,
        toast: `已复制查车结果 ${rows.length} 辆`,
        imageToast: `已导出查车结果 ${rows.length} 辆图片`,
        excelToast: `已导出查车结果 ${rows.length} 辆 Excel 文件`,
      })
    },
    // 点结果行：详情窗 + 精确定位；为避免筛选把目标藏起来，先清掉线路筛选
    onOrgHitPick(bus) {
      if (!bus) return
      if (this.cityFilterNo) {
        this.cityFilterNo = ''
        this.cityHitLine = null
      }
      this.selectBus(bus)
      this.focusBus(bus)
      this.closeOrgSearch()
    },
    // 选中站点：弹出站点详情窗，并异步匹配可换乘线路（两窗互斥，同时只显示一扇）
    selectStop(stop) {
      if (isNaN(stop.lat) || isNaN(stop.lng)) return
      this.selectedBus = null
      this.selectedStop = stop
      this.stopLines = []
      this.stopLinesBusy = true
      this.renderSchematic()
      this.computeStopLines()
    },
    // 换乘线路匹配：全市线网里每条营运方向都存了站点坐标串（GCJ-02，与本站同系），
    // 逐方向做 bbox 快速排除 + haversine 精判（80m 内算途经），再用线路库补起讫站与排序
    async computeStopLines() {
      const stop = this.selectedStop
      if (!stop) return
      const net = await loadCityNet()
      // 等待期间用户已关窗 / 换了站点：结果作废
      if (!net || !this.selectedStop || this.selectedStop !== stop) {
        this.stopLinesBusy = false
        return
      }
      const M = 0.0016 // ≈ 纬度 180m 的快速排除带，先把绝大多数方向挡掉再精算
      const seen = new Map()
      for (const d of net.dirs) {
        if (seen.has(d.no)) continue
        const bb = d.bb
        if (stop.lng < bb[0] - M || stop.lng > bb[2] + M || stop.lat < bb[1] - M || stop.lat > bb[3] + M) continue
        const p = d.p
        for (let i = 0; i + 1 < p.length; i += 2) {
          if (Math.abs(p[i] - stop.lng) > M || Math.abs(p[i + 1] - stop.lat) > M) continue
          if (distance(stop.lat, stop.lng, p[i + 1], p[i]) <= 80) {
            seen.set(d.no, { no: d.no, code: d.code })
            break
          }
        }
      }
      const lib = new Map(allLines().map((l) => [String(l.no), l]))
      const curNo = String(this.lineName || this.lineNo || '')
      const list = []
      seen.forEach((d) => {
        const l = lib.get(String(d.no)) || {}
        // 已停运线路不展示在换乘列表里：无在运车辆，走向也只是历史档案
        if (l.status === '停运') return
        // 所属营运公司徽标：全站统一走 companyOf（永不返回 null），
        // 站点换乘卡里线路号后方就靠它一眼看出是哪家在跑
        const company = companyOf(l)
        // 把 companyOf 的 label 解析成 org-tag 风格需要的 { no, short, isForeign }
        const cLabel = company.label || ''
        const cMatch = cLabel.match(/公交集团·([一二三四五六七八九])营运公司/)
        const cnToArabic = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
        let orgTag
        if (cMatch) {
          orgTag = { no: cnToArabic[cMatch[1]] || cMatch[1], short: cMatch[1] + '公司', isForeign: false }
        } else if (company.key === 'CC') {
          orgTag = { no: 'C', short: cLabel, isForeign: true, logo: company.logo }
        } else if (company.key === 'ML') {
          orgTag = { no: 'M', short: cLabel, isForeign: true, logo: company.logo }
        } else if (company.key === 'HQ') {
          orgTag = { no: 'H', short: cLabel, isForeign: true, logo: company.logo }
        } else {
          orgTag = { no: '?', short: cLabel, isForeign: false }
        }
        list.push({
          no: d.no,
          code: d.code,
          start: l.start || '',
          end: l.end || '',
          order: l.order != null ? l.order : 999999,
          cur: String(d.no) === curNo,
          company,
          orgTag,
        })
      })
      list.sort((a, b) => a.order - b.order || (a.cur ? -1 : 1))
      this.stopLines = list
      this.stopLinesBusy = false
    },
    // 从站点窗跳到换乘线路：嵌入态交给宿主换线（同步 lineCode / 记忆），独立态自己换
    openStopLine(t) {
      this.closeSheet()
      if (t.cur) return
      if (this.embedded) {
        this.$emit('pick-line', {
          lineCode: t.code || buildLineCode(t.no, 0),
          lineName: t.no,
          direction: 0,
          startStop: '',
          endStop: '',
        })
      } else {
        this.loadByLine(t.no, 0)
      }
    },
    // —— 详情窗：拖动 / 固定 / 关闭 ——
    closeSheet() {
      if (this._suppressSheetClick) return
      this.selectedBus = null
      this.selectedStop = null
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
        if (this.sheetPos) writePanelPos('bus-sheet', this.sheetPos)
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
      // 恢复的位置此刻才有真实 DOM 尺寸，再夹一次确保整个窗口都在视口内
      if (this.sheetPos) this.$nextTick(() => this.clampSheetPos())
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
        const dirTxt = hit.bus.dir === 0 ? '上行' : '下行'
        const tip = {
          x: Math.round(hit.p.x + r.left - pr.left),
          y: Math.round(hit.p.y + r.top - pr.top - lift),
          no: `${hit.bus.no || ''} · ${this.fmtNo(hit.bus.orgId || '')} · ${dirTxt}`,
          line: null,
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
      const dirTxt = hit.bus.dir === 0 ? '上行' : '下行'
      const tip = {
        x: Math.round(hit.p.x + r.left - pr.left),
        y: Math.round(hit.p.y + r.top - pr.top - lift),
        no: `${this.lineName || ''} · ${this.fmtNo(hit.bus.orgId || '')} · ${dirTxt}`,
        line: null,
      }
      const old = this.hoverTip
      if (old && old.no === tip.no && old.line === tip.line && Math.abs(old.x - tip.x) < 1 && Math.abs(old.y - tip.y) < 1) return
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
    // 不挑的话"定位"会把车放到窗口正后面，放大了也看不见（桌面端实测就是如此）
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
    // 详情面板内「在地图上定位」：居中 + 放到最大缩放，做到"精确定位到车"
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
        // 同步"当前视野"，否则下一次自动刷新会把画面还原到定位前的位置
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
      return busStateOf(bus, this.stopsByDir[bus.dir], this.routeByDir[bus.dir])
    },
    // 运行状态配色：到站=绿 / 离站=橙 / 行驶=青 / 停靠=琥珀，与详情窗文案同口径
    busStateCls(bus) {
      const s = busStateOf(bus, this.stopsByDir[bus.dir], this.routeByDir[bus.dir])
      return s === '到站' ? 'arrived' : s === '已离站' ? 'departed' : s === '行驶' ? 'moving' : 'stopped'
    },
    /**
     * 计算车辆当前所在站点名。
     *
     * 算法：路线投影 + 累积里程二分定位
     *   1. 将车位投到路线 polyline 上，得到沿线累积距离 cumDist
     *   2. 对每个站点预计算沿线累积距离，构建 [0, d1, d2, ..., dN] 递增数组
     *   3. 二分找到 cumDist 落在哪个段 [i, i+1]
     *   4. 比较车位到 i 站和 i+1 站的欧氏距离，较近者即为所在站点
     *
     * 依赖 this.routeByDir[dir]（路线几何）。无路线时退化为最近站搜索。
     */
    nearStopOf(b) {
      const dir = b.dir
      const stops = this.stopsByDir[dir]
      const route = this.routeByDir[dir]
      if (!stops?.length) return '未知站点'
      const lat = parseFloat(b.lat) || 0
      const lng = parseFloat(b.lng) || 0
      if (isNaN(lat) || isNaN(lng)) return '未知站点'

      // —— 辅助：route 统一为 [{lat,lng}] ——
      function normRoute(raw) {
        if (!Array.isArray(raw) || raw.length < 2) return null
        const first = raw[0]
        if (Array.isArray(first) && typeof first[0] === 'number') return raw.map(([ll, la]) => ({ lat: la, lng: ll }))
        if (first && typeof first.lat === 'number') return raw
        return null
      }
      const segs = normRoute(route)

      // —— 步骤1：车位投到路线上，得沿线累积距离（复用 cumDistAlongRoute）——
      if (segs) {
        const cumDist = cumDistAlongRoute(segs, lat, lng)
        if (cumDist !== null) {
          // —— 步骤2：各站的沿线累积里程，二分定位站点段 ——
          const cumStops = [0]
          for (let i = 0; i < stops.length - 1; i++) {
            cumStops.push(cumStops[i] + distance(parseFloat(stops[i].latitude), parseFloat(stops[i].longitude), parseFloat(stops[i + 1].latitude), parseFloat(stops[i + 1].longitude)))
          }
          let lo = 0, hi = cumStops.length - 1
          while (lo < hi) { const m = (lo + hi + 1) >> 1; cumStops[m] <= cumDist ? (lo = m) : (hi = m - 1) }
          const i = lo
          if (i >= stops.length - 1) return stops[stops.length - 1].stopName || '终点站'
          // —— 步骤3：比较 haversine 距离，取较近站 ——
          const dPrev = distance(lat, lng, parseFloat(stops[i].latitude), parseFloat(stops[i].longitude))
          const dNext = distance(lat, lng, parseFloat(stops[i + 1].latitude), parseFloat(stops[i + 1].longitude))
          return dNext <= dPrev ? (stops[i + 1].stopName || '未知站点') : (stops[i].stopName || '未知站点')
        }
      }

      // —— 无路线几何：退化为 haversine 最近站 ——
      let bestI = -1, bestD = Infinity
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i]
        const d = distance(lat, lng, parseFloat(s.latitude), parseFloat(s.longitude))
        if (d < bestD) { bestD = d; bestI = i }
      }
      if (bestI < 0) return '未知站点'
      const dCur = bestD
      const dPrev = bestI > 0 ? distance(lat, lng, parseFloat(stops[bestI - 1].latitude), parseFloat(stops[bestI - 1].longitude)) : Infinity
      const dNext = bestI < stops.length - 1 ? distance(lat, lng, parseFloat(stops[bestI + 1].latitude), parseFloat(stops[bestI + 1].longitude)) : Infinity
      return dNext <= dCur && dNext < dPrev ? (stops[bestI + 1].stopName || '未知站点') : (stops[bestI].stopName || '未知站点')
    },
    // 在线车辆悬浮提示：方向 / 编号 / 营运公司 / 所在站点 / 时间 / 速度 / 状态 / 经纬度
    busTip(b) {
      const dir = this.dirLabel(b.dir)
      const state = b.arrived === '1' ? '已到站' : '行驶中'
      const coord = b.lat != null && b.lng != null ? `${b.lat}, ${b.lng}` : '经纬度未知'
      return (
        `${dir} · ${b.orgId ? this.fmtNo(b.orgId) : (b.busNo || '?')} · ${this.busCompanyText(b)}\n` +
        `所在站点：${this.nearStopOf(b)}\n` +
        `${String(b.time || '--').slice(0, 5)} · ${b.gpsSpeed}km/h · ${state}\n` +
        coord
      )
    },
    // 一键复制在线车辆信息（TSV：编号/营运公司/所在站点/时间/速度/状态/经纬度），
    // 列格式与「实时线路」页的复制功能一致；「全部」视角按 上行/下行 分两段输出。
    // 所在站点 = 车辆与该方向站点序列里 haversine 最近的一站（见 nearStopOf）
    copyOnlineBuses() {
      const CN = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']
      const companyOf = (b) => {
        const d = String(b.orgId || '').charAt(0)
        return d >= '1' && d <= '9' ? `武汉公交集团${CN[Number(d)]}营运公司` : '营运公司未知'
      }
      // 环形线没有上下行：合并成一段「环形」，不按上/下行拆两段
      const dirs = this.isLoop ? [0] : (this.dirFilter === 2 ? [0, 1] : [this.dirFilter])
      const blocks = []
      const allRows = []
      let total = 0
      for (const dir of dirs) {
        const buses = this.isLoop
          ? [...(this.busesByDir[0] || []), ...(this.busesByDir[1] || [])]
          : (this.busesByDir[dir] || [])
        if (!buses.length) continue
        const dirName = this.dirLabel(dir)
        const cells = buses.map((b) => [
          b.orgId ? this.fmtNo(b.orgId) : (b.busNo || '?'),
          companyOf(b),
          this.nearStopOf(b),
          String(b.time || '--').slice(0, 5),
          `${b.gpsSpeed}km/h`,
          b.arrived === '1' ? '到站' : busStateOf(b, this.stopsByDir[dir], this.routeByDir[dir]),
          `${b.lat},${b.lng}`,
        ])
        cells.forEach((c) => allRows.push([dirName, ...c]))
        total += cells.length
        blocks.push(
          `${this.lineName || this.lineNo}（${dirName}） 在线 ${cells.length} 辆\n` +
            '编号\t营运公司\t所在站点\t时间\t速度\t状态\t经纬度\n' +
            cells.map((c) => c.join('\t')).join('\n')
        )
      }
      if (!total) {
        uni.showToast({ title: '当前无在线车辆', icon: 'none' })
        return
      }
      copyTable({
        title: `${this.lineName || this.lineNo} 在线车辆（共 ${total} 辆）`,
        columns: ['方向', '编号', '营运公司', '所在站点', '时间', '速度', '状态', '经纬度'],
        rows: allRows,
        text: blocks.join('\n'), // 文本模式保留原有的上行/下行分段格式
        toast: `已复制 ${total} 辆车信息`,
        imageToast: `已导出 ${total} 辆车信息图片`,
        excelToast: `已导出 ${total} 辆车信息 Excel 文件`,
      })
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
  /* 线路号输入卡与实时车辆/发车时刻栏共用同一宽度，避免移动端两栏错位 */
  --panel-w: 720rpx;
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
    radial-gradient(60% 45% at 72% 18%, rgba(var(--ac-rgb), 0.18), transparent 70%),
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
/* 仿真站牌模式：画布不再抓取拖动，触摸滚动交还给站牌层 */
.schematic.sim-board {
  cursor: default;
  touch-action: auto;
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
  /* 叠加层整体 pointer-events:none（不挡地图拖拽），仅站名放开可点 → 弹站点详情窗 */
  pointer-events: auto;
  cursor: pointer;
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
/* 地图站名前缀：起(绿) / 终(琥珀)，与站点圆点同语义 */
.stop-label .lb-end {
  font-weight: 800;
}
.stop-label.end-first .lb-end {
  color: #22c55e;
}
.stop-label.end-last .lb-end {
  color: #f59e0b;
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
/* 鼠标悬停车辆图标的浮标：内容与编号标签模式联动（单行完整格式），离开即消失（不常驻、不拦截鼠标） */
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
.ln.loop { background: #a78bfa; }
/* 窄屏：底部让位给车辆横栏，隐藏图例（颜色说明已写进控制卡提示） */
@media (max-width: 720px) {
  .schematic-legend {
    display: none;
  }
}
/* 左上角控制卡：整块是一张玻璃卡片，紧凑贴合内容高度 */
.ctrl {
  position: absolute;
  top: 12rpx;
  left: 12rpx;
  width: var(--panel-w);
  max-width: calc(100vw - 24rpx);
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4rpx;
  box-sizing: border-box;
  background: rgba(11, 16, 32, 0.82);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  border: 2rpx solid rgba(255, 255, 255, 0.14);
  border-radius: 16rpx;
  box-shadow: 0 10rpx 28rpx rgba(0, 0, 0, 0.42), inset 0 1rpx 0 rgba(255, 255, 255, 0.08);
  z-index: 10;
}
/* 仅用于宿主顶栏与主体内容的分隔 */
.ctrl-div {
  height: 1rpx;
  margin: 4rpx 0;
  background: rgba(255, 255, 255, 0.07);
}
/* 搜索行：透明背景（背景由宿主 .ctrl 统一提供） */
.ctrl-search {
  display: flex;
  align-items: center;
  gap: 6rpx;
}
.ctrl-icon {
  flex-shrink: 0;
  font-size: 22rpx;
  opacity: 0.75;
}
/* 自定义导航后的返回按钮 */
.ctrl-back {
  flex-shrink: 0;
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  border-radius: 14rpx;
  font-size: 32rpx;
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
  height: 36rpx;
  font-size: 22rpx;
  color: #fff;
  background: transparent;
  border: none;
}
.ctrl-ph {
  color: rgba(255, 255, 255, 0.38);
}
.ctrl-go {
  flex-shrink: 0;
  height: 36rpx;
  line-height: 36rpx;
  padding: 0 16rpx;
  font-size: 22rpx;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  border-radius: 12rpx;
  cursor: pointer;
  transition: filter 0.18s;
}
.ctrl-go:active {
  filter: brightness(1.12);
}
.org-tag {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.18), rgba(251, 191, 36, 0.06));
  border: 2rpx solid rgba(251, 191, 36, 0.42);
  border-radius: 999rpx;
  padding: 2rpx 18rpx 2rpx 2rpx;
  white-space: nowrap;
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.14), 0 3rpx 8rpx rgba(251, 191, 36, 0.12);
}
.org-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  font-size: 24rpx;
  font-weight: 800;
  color: #1a1205;
  background: linear-gradient(135deg, #fde68a, #fbbf24 45%, #f59e0b);
  box-shadow: 0 4rpx 12rpx rgba(251, 191, 36, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.6),
    inset 0 -2rpx 4rpx rgba(180, 83, 9, 0.3);
  margin-right: 10rpx;
  flex-shrink: 0;
}
.org-name {
  font-size: 18rpx;
  line-height: 1;
  font-weight: 700;
  color: #fde68a;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1rpx 2rpx rgba(0, 0, 0, 0.3);
}
/* 非集团线路的公司徽标：左侧直接放公司自己的 SVG 标（自带配色），文字走中性白不抢色；
   圆标尺寸与集团线的 .org-no 对齐，同一行混排时高度不跳 */
.org-tag.foreign {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.18);
}
.org-logo {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  margin-right: 10rpx;
  flex-shrink: 0;
}
.org-tag.foreign .org-name {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 700;
}
/* 右侧栏：一张列容器把「实时车辆」与「发车时刻表」两张独立卡片上下排好。
   高度交给内容（不写 bottom），否则卡下方的空白条会盖住地图、吃掉拖拽手势 */
.side-col {
  position: absolute;
  top: 24rpx;
  right: 24rpx;
  width: var(--panel-w);
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
/* 窄屏（手机）整列回落为底部横栏：时刻表卡仍在车辆面板下方，两块一起贴底。
   bottom 抬到 120rpx，给放大后的底部快捷栏（bottom 12rpx + 高约 90rpx）让位，
   否则 side-col(z-index 20) 会盖住 bottom-bar(z-index 11)，手机上完全看不到工具按钮。 */
@media (max-width: 720px) {
  /* 输入卡与实时车辆/发车时刻栏强制同宽同边距：
     不用 width:auto（不同机型 rpx 换算下会与右侧栏差十几像素），直接显式同宽 */
  .ctrl {
    left: 20rpx;
    right: auto;
    width: calc(100vw - 40rpx);
    max-width: calc(100vw - 40rpx);
    box-sizing: border-box;
  }
  .side-col {
    top: auto;
    left: 20rpx;
    right: auto;
    bottom: 132rpx;
    width: calc(100vw - 40rpx);
    max-width: calc(100vw - 40rpx);
    max-height: 46vh;
    z-index: 18;
    box-sizing: border-box;
  }
  /* 底部工具条永远压在面板之上，避免移动端折叠覆盖后按钮点不到 */
  .bottom-bar { z-index: 22; }
}
.panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  margin-bottom: 18rpx;
}
/* 非集团线路的数据来源说明条 */
.foreign-note {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 16rpx;
  padding: 12rpx 14rpx;
  border-radius: 14rpx;
  font-size: 20rpx;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.fn-logo { flex: 0 0 auto; width: 34rpx; height: 34rpx; border-radius: 8rpx; }
/* 折叠态：只收车辆列表，高度自然收缩 */
.panel.collapsed .panel-header {
  margin-bottom: 0;
}
/* 线路号徽章 + 营运公司徽标行：紧跟在面板标题下方，仅在有线路号时显示 */
.panel-line-info {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 4rpx 14rpx;
  flex-wrap: nowrap;
  min-width: 0;
  border-bottom: 1rpx solid rgba(255, 255, 255, 0.06);
}
.pli-badge {
  flex-shrink: 0;
  height: 32rpx;
  padding: 0 14rpx;
  border-radius: 999rpx;
  background: rgba(var(--ac-rgb), 0.18);
  border: 2rpx solid rgba(var(--ac-rgb), 0.45);
  font-size: 22rpx;
  font-weight: 800;
  color: var(--ac-text);
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.pli-companies {
  display: flex;
  align-items: center;
  gap: 6rpx;
  margin-left: auto;
  flex-shrink: 0;
}
/* 刷新行：标题栏下方的独立一行，按钮宽度不被标题挤压而竖排换行 */
.panel-tools {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin: 12rpx 0 18rpx;
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
  background: rgba(var(--ac-rgb), 0.3);
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
  position: relative;
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
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 刷新控件：左半 ↻ 立即刷一次，右半显示当前间隔并可展开设置（手动 / 15 / 20 / 30 秒） */
.refresh-wrap {
  position: relative;
  flex-shrink: 0;
}
.refresh-pill {
  display: flex;
  align-items: stretch;
  /* 固定高度与复制胶囊（.copy-pill）对齐：同一行两个控件大小统一 */
  height: 56rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  overflow: hidden;
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  box-shadow: 0 8rpx 20rpx rgba(6, 182, 212, 0.35);
}
/* 自动刷新进行中：外圈加一道青色光环，一眼看出"正在自动跑" */
.refresh-pill.auto {
  box-shadow: 0 0 0 3rpx rgba(103, 232, 249, 0.55), 0 8rpx 20rpx rgba(6, 182, 212, 0.35);
}
.refresh-pill.busy .rp-refresh {
  opacity: 0.55;
}
.rp-refresh {
  display: flex;
  align-items: center;
  padding: 0 16rpx 0 22rpx;
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
  padding: 0 20rpx 0 16rpx;
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
/* 间隔下拉展开时把整卡提到发车时刻卡之上：
   .panel 带 backdrop-filter 会形成层叠上下文，内部下拉的 z-index 出不了卡，
   而 .plan-side 是 DOM 靠后的兄弟（也各自成层叠上下文），同层按序绘制会盖住下拉；
   故展开期间给 .panel 显式 z-index，收回后移除、不影响原层级 */
.panel.menu-open {
  z-index: 1;
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
/* 下拉的"点外部关闭"透明遮罩：面板带 backdrop-filter 会形成包含块，遮罩只能放在面板外层 */
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
  padding: 16rpx 0;
}
.bus-left {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
.bus-org {
  font-size: 34rpx;
  font-weight: 800;
  color: var(--ac-hi);
  font-variant-numeric: tabular-nums;
}
/* 所在站点：介于自编号与 MD5 之间的次要信息，青灰醒目但不抢主色 */
.bus-stop {
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.62);
  margin-top: 3rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bus-hash {
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 3rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bus-right {
  font-size: 24rpx;
  text-align: right;
  flex-shrink: 0;
  margin-left: 16rpx;
}
.bus-speed {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  color: #67e8f9;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bus-kmh { white-space: nowrap; }
/* 运行状态徽标：到站绿 / 行驶青 / 停靠琥珀，字号小于速度，不抢主信息 */
.bus-state {
  padding: 1rpx 10rpx;
  border-radius: 8rpx;
  font-size: 19rpx;
  line-height: 1.5;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}
.bus-state.arrived { color: #6ee7b7; background: rgba(16, 185, 129, 0.16); }
/* 已离站：车辆明显离开上一站（>500m），但 GPS 速度尚未恢复，区别于「停靠」*/
.bus-state.departed { color: #fb923c; background: rgba(249, 115, 22, 0.15); }
.bus-state.moving { color: #67e8f9; background: rgba(6, 182, 212, 0.16); }
.bus-state.stopped { color: #fcd34d; background: rgba(245, 158, 11, 0.14); }
.bus-time {
  margin-top: 6rpx;
  color: rgba(255, 255, 255, 0.55);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.empty {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 26rpx;
  padding: 40rpx 0;
}
/* 走向尚未贴路（计算中/失败）的提示，避免把站间直连当成真实走向 */
.view-alert {
  align-self: flex-start;
  font-size: 17rpx;
  line-height: 1.3;
  color: rgba(251, 191, 36, 0.85);
  padding: 3rpx 12rpx;
  border-radius: 8rpx;
  background: rgba(251, 191, 36, 0.08);
  margin-top: 2rpx;
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
.bus-dir.loop {
  color: #ddd6fe;
  background: rgba(139, 92, 246, 0.18);
  border: 2rpx solid rgba(167, 139, 250, 0.45);
}
/* 车辆分组头：方向徽标 + 辆数（参考发车时刻的分组方式，行内不再重复方向） */
.bus-group-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 0 6rpx;
}
.bus-group-head .bus-dir {
  margin-left: 0;
}
.bus-group-count {
  flex: 1;
  min-width: 0;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.42);
  text-align: right;
  white-space: nowrap;
}
/* 车辆详情窗：可拖动浮窗（默认居中贴底；拖动过后改用 left/top 绝对定位） */
.bus-sheet {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 160rpx;
  width: 880rpx;
  max-width: calc(100vw - 20rpx);
  z-index: 30;
  background: rgba(11, 16, 32, 0.86);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 32rpx;
  padding: 0 24rpx 24rpx;
  box-sizing: border-box;
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.18);
  /* 位置由 JS 直接给 left/top：不能加 transition，否则拖动跟手有延迟 */
}
/* 标题栏就是拖动手柄：按住任意空白处即可移动窗口 */
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
  padding: 22rpx 0 18rpx;
  margin-bottom: 4rpx;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.1);
  cursor: move;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
/* 拖动中：提升阴影，视觉上"拿起来了" */
.bus-sheet.dragging {
  box-shadow: 0 32rpx 84rpx rgba(0, 0, 0, 0.62), 0 0 0 2rpx rgba(103, 232, 249, 0.35);
}
/* 已固定：标题栏不可拖，边框变成紫色提示"锁定中" */
.bus-sheet.pinned {
  border-color: rgba(var(--ac-rgb), 0.55);
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
/* 拖动把柄：一个竖排点阵，暗示"这里可以拖" */
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
  color: var(--ac-text);
  background: rgba(var(--ac-rgb), 0.3);
  border-color: rgba(var(--ac-rgb), 0.65);
}
/* 站点详情窗：换乘线路改两列卡片网格，10 条左右一屏可见，超出才滚动 */
.st-list {
  margin-top: 16rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  align-content: start;
  max-height: 540rpx;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2rpx 8rpx 6rpx 2rpx;
}
.st-list::-webkit-scrollbar {
  width: 6rpx;
}
.st-list::-webkit-scrollbar-thumb {
  border-radius: 6rpx;
  background: linear-gradient(180deg, rgba(var(--ac-rgb), 0.6), rgba(139, 92, 246, 0.5));
}
/* 换乘卡：带内高光的玻璃质感 + 细亮边，整张卡有"抬起来"的层次。
   左侧一条色带随方向色，hover/当前态点亮，静止时低调不抢戏。 */
.st-chip {
  position: relative;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 14rpx 14rpx 16rpx 18rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 18rpx;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.025));
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.08), 0 6rpx 18rpx rgba(0, 0, 0, 0.18);
  cursor: pointer;
  overflow: hidden;
  transition: background 0.22s, border-color 0.22s, box-shadow 0.22s, transform 0.15s;
}
/* 左侧方向色带 */
.st-chip::before {
  content: '';
  position: absolute;
  left: 0;
  top: 16rpx;
  bottom: 16rpx;
  width: 5rpx;
  border-radius: 0 6rpx 6rpx 0;
  background: linear-gradient(180deg, rgba(var(--ac-rgb), 0.9), rgba(139, 92, 246, 0.7));
  opacity: 0.45;
  transition: opacity 0.22s;
}
.st-chip:hover {
  background: linear-gradient(145deg, rgba(var(--ac-rgb), 0.18), rgba(var(--ac-rgb), 0.06));
  border-color: rgba(var(--ac-rgb), 0.55);
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.14), 0 10rpx 26rpx rgba(var(--ac-rgb), 0.18);
  transform: translateY(-3rpx);
}
.st-chip:hover::before {
  opacity: 1;
}
.st-chip:active {
  opacity: 0.82;
  transform: translateY(0) scale(0.985);
}
/* 当前线路：琥珀色温 + 暖光晕 + 左侧亮色带，从换乘清单里一眼挑出 */
.st-chip.cur {
  border-color: rgba(252, 211, 77, 0.62);
  background: linear-gradient(145deg, rgba(252, 211, 77, 0.2), rgba(251, 191, 36, 0.07));
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.18), 0 8rpx 26rpx rgba(251, 191, 36, 0.25),
    0 0 0 1rpx rgba(252, 211, 77, 0.12);
}
.st-chip.cur::before {
  background: linear-gradient(180deg, #fde68a, #f59e0b);
  opacity: 1;
  width: 6rpx;
}
.st-chip.cur:hover {
  background: linear-gradient(145deg, rgba(252, 211, 77, 0.28), rgba(251, 191, 36, 0.1));
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.2), 0 12rpx 30rpx rgba(251, 191, 36, 0.32);
}
.st-top {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}
/* 线路号徽章：立体公交站牌质感（顶部高光 + 底部阴影），等宽数字；
   当前线路换成琥珀金牌 */
.st-no {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 2rpx 14rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  white-space: nowrap;
  border-radius: 10rpx;
  background: linear-gradient(160deg, rgba(var(--ac-rgb), 0.96), rgba(var(--ac-rgb), 0.72));
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 800;
  line-height: 40rpx;
  letter-spacing: 0.5rpx;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.32), 0 4rpx 10rpx rgba(var(--ac-rgb), 0.3);
  text-shadow: 0 1rpx 2rpx rgba(0, 0, 0, 0.25);
}
.st-chip.cur .st-no {
  background: linear-gradient(160deg, #fde68a, #f59e0b);
  color: #3a2703;
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.6), 0 4rpx 12rpx rgba(245, 158, 11, 0.45);
  text-shadow: none;
}
/* 换乘卡里线路号后方的所属公司徽标：统一走 .org-tag（金色圆圈+公司名），
  非集团线加 .foreign（白边+logo）。全名在 title 里 */
/* 第二行：乘客最关心的「开往哪」——单独成标签 + 高亮目的地，字号加大提亮；
   超长终点站名以省略号截断，保证两列卡片网格等高整齐 */
.st-end {
  min-width: 0;
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 6rpx;
}
.st-to {
  flex: 0 0 auto;
  font-size: 18rpx;
  line-height: 26rpx;
  color: rgba(255, 255, 255, 0.45);
}
.st-dest {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 22rpx;
  line-height: 30rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.st-chip.cur .st-dest {
  color: #fde68a;
}
/* "当前"胶囊：琥珀实心小标，和线路金牌呼应 */
.st-cur {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 18rpx;
  line-height: 1;
  color: #3a2703;
  font-weight: 800;
  letter-spacing: 1rpx;
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  background: linear-gradient(135deg, #fde68a, #f59e0b);
  box-shadow: 0 3rpx 8rpx rgba(245, 158, 11, 0.35);
}
/* 切换箭头：圆形幽灵按钮，hover 时点亮成方向色 */
.st-go {
  flex: 0 0 auto;
  margin-left: auto;
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 24rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.38);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  transition: color 0.2s, background 0.2s, border-color 0.2s, transform 0.2s;
}
.st-chip:hover .st-go {
  color: #ffffff;
  background: rgba(var(--ac-rgb), 0.85);
  border-color: rgba(var(--ac-rgb), 0.9);
  transform: translate(2rpx, -2rpx);
}
.st-none {
  grid-column: 1 / -1;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.5);
  padding: 20rpx 8rpx;
  text-align: center;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.03);
  border: 2rpx dashed rgba(255, 255, 255, 0.1);
}
.sheet-line {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 36rpx;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
  letter-spacing: 0.5rpx;
  text-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.3);
}
.sheet-dir {
  flex: 0 0 auto;
  font-size: 20rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
  border-radius: 999rpx;
  padding: 6rpx 22rpx;
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.25);
}
.sheet-dir.d0 {
  color: #ecfeff;
  background: linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(34, 211, 238, 0.24));
  border: 2rpx solid rgba(34, 211, 238, 0.65);
  box-shadow: 0 4rpx 12rpx rgba(6, 182, 212, 0.28), inset 0 1rpx 0 rgba(255, 255, 255, 0.25);
}
.sheet-dir.d1 {
  color: #fff1f2;
  background: linear-gradient(135deg, rgba(225, 29, 72, 0.4), rgba(251, 113, 133, 0.24));
  border: 2rpx solid rgba(251, 113, 133, 0.65);
  box-shadow: 0 4rpx 12rpx rgba(225, 29, 72, 0.28), inset 0 1rpx 0 rgba(255, 255, 255, 0.25);
}
.sheet-dir.loop {
  color: #f5f3ff;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(167, 139, 250, 0.24));
  border: 2rpx solid rgba(167, 139, 250, 0.65);
  box-shadow: 0 4rpx 12rpx rgba(139, 92, 246, 0.28), inset 0 1rpx 0 rgba(255, 255, 255, 0.25);
}
/* 元数据行：左侧线路归属胶囊 + 右侧换乘条数胶囊，分列两端、各自成标 */
/* 站点详情窗的元信息行：左标签 + 右值，与车辆窗旧版同构 */
.sheet-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  min-width: 0;
  padding: 14rpx 0;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.06);
}
.ss-tag {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 20rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.ss-org {
  flex: 0 0 auto;
  text-align: right;
  font-size: 20rpx;
  font-weight: 700;
  color: var(--ac-text, #a5f3fc);
  white-space: nowrap;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(var(--ac-rgb), 0.14);
  border: 2rpx solid rgba(var(--ac-rgb), 0.32);
}
/* 2×2 指标网格：标签在上、数值在下；竖线分左右列，横线分上下行 */
.sheet-grid {
  display: flex;
  flex-wrap: wrap;
}
.sg-cell {
  box-sizing: border-box;
  width: 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 18rpx 20rpx;
}
.sg-cell:nth-child(odd) {
  padding-right: 24rpx;
}
.sg-cell:nth-child(even) {
  padding-left: 24rpx;
  border-left: 1rpx solid rgba(255, 255, 255, 0.06);
}
.sg-cell:nth-child(n+3) {
  border-top: 1rpx solid rgba(255, 255, 255, 0.06);
}
.sg-k {
  font-size: 19rpx;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  letter-spacing: 0.5rpx;
}
/* 车速单元：分档色数字 + 单位，与车速榜同一套快慢语义 */
.sg-v {
  display: inline-flex;
  align-items: baseline;
  gap: 2rpx;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
.sg-num {
  font-size: 28rpx;
  font-weight: 800;
  line-height: 1;
  color: #eef1ff;
  font-variant-numeric: tabular-nums;
}
.sg-u {
  margin-left: 2rpx;
  font-size: 18rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.46);
}
/* 坐标：等宽数字 + 6 位小数，单行展示 */
.sheet-coord {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  min-width: 0;
  padding: 14rpx 0;
  border-bottom: 1rpx solid rgba(255, 255, 255, 0.06);
}
.sc-v {
  flex: 1 1 0;
  min-width: 0;
  text-align: right;
  font-size: 21rpx;
  font-weight: 600;
  color: #eef1ff;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.3rpx;
}
/* 当前走向：起绿圆点 / 终琥珀圆点，站名过长时各自省略，箭头不压缩 */
.sheet-route {
  padding: 14rpx 0;
  border-bottom: 1rpx solid rgba(255, 255, 255, 0.06);
}
/* 走向行：起讫站一行走完，方向徽标靠右推到行尾 */
.sr-line {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
}
.sr-dir {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 1rpx 10rpx;
  border-radius: 7rpx;
  font-size: 18rpx;
}
.sr-dir.d0 { color: #67e8f9; background: rgba(6, 182, 212, 0.18); }
.sr-dir.d1 { color: #fda4af; background: rgba(225, 29, 72, 0.18); }
.sr-dir.loop { color: #ddd6fe; background: rgba(139, 92, 246, 0.18); }
/* 起讫站圆点：起绿 / 终琥珀，比徽标更轻量 */
.sr-dot {
  flex: 0 0 auto;
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
}
.sr-start { background: #22c55e; box-shadow: 0 0 0 3rpx rgba(34, 197, 94, 0.22); }
.sr-end { background: #f59e0b; box-shadow: 0 0 0 3rpx rgba(245, 158, 11, 0.22); }
.sr-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 22rpx;
  font-weight: 600;
  color: #eef1ff;
}
/* 起站名按文字实际宽度排，箭头紧跟其后；两段等宽会把箭头顶到行中间偏右 */
.sr-from {
  flex: 0 1 auto;
  /* 超长起站名也要留出终站名的空间，箭头最远不越过行中点 */
  max-width: 38%;
}
.sr-to {
  /* basis 必须是 0：用 auto 会把终站名的内容宽计入收缩基准，反过来挤掉起站名 */
  flex: 1 1 0;
}
.sr-arrow {
  flex: 0 0 auto;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.42);
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
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  border: none;
}
/* 全市详情窗的"打开这条线路"：主行动用靛蓝青渐变（与定位键的次操作拉开） */
.sheet-btn.go {
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  border: none;
}
/* —— 全市实时分布 —— */
/* 统计行：卡片内的一行小字，不自带背景/描边（控制卡是"整卡包裹"，子块再套壳就退回碎片感） */
/* —— 全市实时分布 —— */
.ctrl-city {
  display: flex;
  flex-direction: column;
  gap: 3rpx;
  padding: 5rpx 10rpx;
  border-radius: 12rpx;
  background: rgba(255, 255, 255, 0.03);
}
/* 指标组：数字重、标签轻，靠字号与透明度分层；格子之间一条极淡竖线断开，不各自套背景 */
.cc-figs {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  row-gap: 4rpx;
}
.cc-fig {
  display: flex;
  align-items: baseline;
  padding: 0 10rpx;
}
.cc-fig:first-child {
  padding-left: 4rpx;
}
.cc-fig + .cc-fig {
  border-left: 2rpx solid rgba(255, 255, 255, 0.07);
}
.f-num {
  font-size: 32rpx;
  font-weight: 800;
  line-height: 1.05;
  color: #fff;
  letter-spacing: -0.6rpx;
  font-variant-numeric: tabular-nums;
}
/* 分母（已完成/总方向）：同一个数字的后半段，压小压淡到不抢主体 */
.f-sub {
  font-size: 18rpx;
  font-weight: 600;
  line-height: 1;
  color: rgba(255, 255, 255, 0.36);
  font-variant-numeric: tabular-nums;
}
.f-lab {
  margin-left: 6rpx;
  font-size: 18rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
}
/* 已筛选徽标：琥珀色表示"现在看到的是子集"，✕ 就在它里面，不必去按钮行找；
   芯片整体可点（打开该线路），hover 微亮提示 */
.cc-chip {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  margin-left: 10rpx;
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(245, 158, 11, 0.14);
  border: 2rpx solid rgba(251, 191, 36, 0.4);
  cursor: pointer;
  transition: background 0.2s;
}
.cc-chip:hover {
  background: rgba(252, 211, 77, 0.22);
}
.chip-txt {
  font-size: 18rpx;
  font-weight: 700;
  line-height: 1.2;
  color: #fcd34d;
  white-space: nowrap;
}
.chip-x {
  font-size: 18rpx;
  line-height: 1.2;
  color: rgba(252, 211, 77, 0.7);
  cursor: pointer;
}
/* 元信息：时间戳 + 线网规模，整行小字且允许自然换行 */
.cc-meta {
  display: flex;
  flex-wrap: wrap;
  padding: 0 4rpx;
}
.cm-item {
  font-size: 17rpx;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.44);
}
/* 快照过期 / 本轮中止：单独一行琥珀色，与上面的灰色元信息拉开优先级 */
.cc-warn {
  padding: 0 4rpx;
  font-size: 17rpx;
  line-height: 1.3;
  color: #fbbf24;
}
/* 扫描进度条：扫描中才出现，走满后由统计文本接手 */
.cc-bar {
  height: 4rpx;
  border-radius: 2rpx;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
}
.cc-bar-in {
  height: 100%;
  border-radius: 3rpx;
  background: linear-gradient(90deg, var(--ac), var(--ac-2));
  transition: width 0.25s ease-out;
}
/* 全市数据操作行（已合并至底部栏，此处仅兼容旧引用） */
.ctrl-city-row {
  display: none;
}
/* 底部快捷操作栏：常驻贴底，所有高频操作合一（9~11 个按钮，紧凑排布） */
.bottom-bar {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 12rpx;
  z-index: 11;
  display: flex;
  align-items: center;
  gap: 0;
  /* 手机端 10 个按钮横向排列会超出屏幕；限宽后靠 overflow-x:auto 横向滑动 */
  max-width: calc(100vw - 24rpx);
  padding: 8rpx 8rpx;
  border-radius: 32rpx;
  background: rgba(11, 16, 32, 0.82);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1rpx solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.42);
  overflow-x: auto;
}
.bb-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 68rpx;
  height: 62rpx;
  padding: 4rpx 10rpx;
  border-radius: 18rpx;
  cursor: pointer;
  transition: background 0.16s, color 0.16s;
  flex-shrink: 0;
}
.bb-item:hover { background: rgba(255, 255, 255, 0.1); }
.bb-item.on { background: rgba(var(--ac-rgb), 0.28); }
.bb-item.on .bb-label { color: var(--ac-text); }
.bb-ico {
  font-size: 32rpx;
  line-height: 1;
  margin-bottom: 2rpx;
  color: rgba(255, 255, 255, 0.72);
}
.bb-ico.up   { color: #22D3EE; }
.bb-ico.down { color: #FB7185; }
.bb-ico.all  { color: #A78BFA; }
.bb-ico.spin { animation: rp-spin 0.9s linear infinite; }
.bb-label {
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  letter-spacing: 0.03em;
}
/* 分组：组内紧贴、组间用间距 + 竖线区分 */
.bb-group {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
/* 实时线路：独立一组，浅色描边胶囊背景突出，与其它工具键拉开 */
.bb-group-stops {
  margin-left: 8rpx;
  padding-left: 8rpx;
  border-left: 2rpx solid rgba(255, 255, 255, 0.18);
}
.bb-stops {
  min-width: 104rpx;
  padding: 4rpx 12rpx;
  background: rgba(var(--ac-rgb), 0.16);
  border: 2rpx solid rgba(var(--ac-rgb), 0.4);
}
.bb-stops .bb-label { font-size: 16rpx; letter-spacing: 0; }
.bb-stops.on { background: var(--ac); border-color: var(--ac); }
.bb-stops.on .bb-ico, .bb-stops.on .bb-label { color: #fff; }
.bb-sep {
  flex: 0 0 1rpx;
  width: 1rpx;
  height: 36rpx;
  margin: 0 4rpx;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 1rpx;
  flex-shrink: 0;
}
/* 数据操作键尺寸 */
.cc-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 48rpx;
  padding: 0 16rpx;
  box-sizing: border-box;
  font-size: 19rpx;
  line-height: 1;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.07);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
  border-radius: 12rpx;
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
  background: rgba(var(--ac-rgb), 0.22);
}
/* 自动跟随已开启：用靛蓝而不是上行的青，避免与方向色抢语义 */
.cc-btn.on {
  color: var(--ac-text);
  background: rgba(var(--ac-rgb), 0.22);
  border-color: rgba(var(--ac-rgb), 0.55);
}
/* 自编号查车浮窗：与车速榜同处右上，玻璃浮窗语言一致 */
.org-search {
  position: absolute;
  top: 24rpx;
  right: 24rpx;
  width: 720rpx;
  max-width: calc(100vw - 48rpx);
  z-index: 23;
  box-sizing: border-box;
  max-height: 58vh;
  display: flex;
  flex-direction: column;
  /* 与车速榜共存：下移到上半区榜单下方，限高与列表滚动由 .with-rank 覆盖 */
  border-radius: 28rpx;
  background: rgba(11, 16, 32, 0.9);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.48);
  /* 不用 overflow:hidden：头部复制胶囊的下拉要能溢出；列表自身 scroll-view 已裁剪 */
}
.os-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 20rpx 24rpx 16rpx;
  border-bottom: 2rpx solid rgba(255, 255, 255, 0.1);
}
/* 拖动 grip：只此手柄可拖窗口，标题/输入不受影响 */
.os-grip {
  flex: 0 0 auto;
  font-size: 26rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.38);
  cursor: grab;
  user-select: none;
  padding: 4rpx 6rpx;
}
.os-grip:active { cursor: grabbing; color: var(--ac-hi); }
.os-title { flex: 1; min-width: 0; }
.os-title { font-size: 27rpx; font-weight: 800; color: #fff; }
.os-close {
  min-width: 44rpx;
  height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.66);
  background: rgba(255, 255, 255, 0.07);
  cursor: pointer;
}
.os-close:hover { color: #fff; background: rgba(var(--ac-rgb), 0.24); }
/* 与车速榜共存：查车面板落到榜单（上半区 34vh）下方，列表在剩余空间内滚动 */
.org-search.with-rank {
  top: calc(34vh + 44rpx);
  max-height: calc(58vh - 20rpx);
}
.org-search.with-rank .os-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.org-search.with-rank .os-list {
  flex: 1;
  height: auto;
  min-height: 160rpx;
}
/* 面板本体已有 max-height:58vh + flex 列：这里必须 flex:1 + min-height:0，
   否则结果列表撑破面板上限，数据多时溢出屏幕（与车速榜 .rank-body 同口径）。 */
.os-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 20rpx 24rpx 24rpx;
}
.os-input-row {
  display: flex;
  gap: 12rpx;
}
.os-input {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  font-size: 23rpx;
  color: #fff;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.1);
}
.os-go {
  flex: 0 0 auto;
  min-width: 120rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14rpx;
  font-size: 23rpx;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--ac), var(--ac-hi));
  cursor: pointer;
}
.os-tip {
  margin-top: 14rpx;
  font-size: 19rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.42);
}
/* 结果计数条：命中数 + 当前尾号一眼可见 */
.os-count {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: 16rpx;
  padding: 0 4rpx 10rpx;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.6);
}
.os-count-info {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
  white-space: nowrap;
}
.os-count-n { font-size: 26rpx; font-weight: 800; color: var(--ac-hi); }
.os-count-key {
  padding: 3rpx 12rpx;
  border-radius: 10rpx;
  font-size: 18rpx;
  color: #fcd34d;
  background: rgba(252, 211, 77, 0.1);
}
/* 结果列表：占满面板剩余高度并内部滚动（与车速榜 .rank-list 同口径），
   不再固定 520rpx——面板自己有 max-height:58vh，列表跟着收缩 scrolling。 */
.os-list {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.os-row {
  padding: 14rpx 16rpx;
  margin-bottom: 8rpx;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.04);
  border: 2rpx solid transparent;
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s;
}
.os-row:hover { background: rgba(var(--ac-rgb), 0.14); border-color: rgba(var(--ac-rgb), 0.4); }
.osr-top {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}
.osr-no { font-size: 25rpx; font-weight: 800; color: #fff; white-space: nowrap; }
.osr-dir { padding: 1rpx 9rpx; border-radius: 7rpx; font-size: 18rpx; }
.osr-dir.d0 { color: #67e8f9; background: rgba(6, 182, 212, 0.18); }
.osr-dir.d1 { color: #fda4af; background: rgba(225, 29, 72, 0.18); }
.osr-org { font-size: 20rpx; font-weight: 600; color: #fcd34d; white-space: nowrap; }
.osr-locate { margin-left: auto; font-size: 18rpx; color: var(--ac-hi); font-weight: 600; white-space: nowrap; }
.osr-sub {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 8rpx;
  min-width: 0;
}
.osr-route {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.62);
}
.osr-speed { flex: 0 0 auto; font-size: 19rpx; color: rgba(255, 255, 255, 0.5); font-variant-numeric: tabular-nums; }
.osr-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: 7rpx;
  font-size: 17rpx;
}
.osr-company {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.34);
}
.osr-stop {
  flex: 0 0 auto;
  max-width: 55%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.46);
}
.os-miss {
  margin-top: 18rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  background: rgba(255, 196, 128, 0.06);
  border: 2rpx solid rgba(255, 196, 128, 0.16);
  font-size: 20rpx;
  line-height: 1.6;
  color: rgba(255, 196, 128, 0.8);
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
  background: rgba(var(--ac-rgb), 0.9);
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