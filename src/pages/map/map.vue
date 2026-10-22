<template>
  <view class="page">
    <!-- 有地图 Key：渲染原生地图；:key 变化时整体重建，杜绝旧 callout 浮层残留 -->
    <map
      v-if="useMap"
      :key="mapKey"
      class="map"
      :latitude="mapCenter.lat"
      :longitude="mapCenter.lng"
      :markers="markers"
      :polyline="polylines"
      :scale="13"
      :show-location="false"
      @markertap="onMarkerTap"
    ></map>

    <!-- 无地图 Key：降级为线路示意图（基于站点经纬度绘制，无需任何 key） -->
    <view v-else class="schematic">
      <view class="schematic-tip">
        未配置地图 Key，当前为线路示意图
        <text class="tip-link" @click="goSettings">配置高德 Key</text>
      </view>
      <svg v-if="routePoints.length" class="route-svg" :viewBox="`0 0 ${svgW} ${svgH}`" preserveAspectRatio="xMidYMid meet">
        <!-- 线路走向 -->
        <polyline
          :points="routePoints"
          fill="none"
          stroke="#818cf8"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <!-- 站点 -->
        <circle
          v-for="s in svgStops"
          :key="s.id"
          :cx="s.x"
          :cy="s.y"
          r="3.5"
          fill="#0b1020"
          stroke="#818cf8"
          stroke-width="2"
        >
          <title>{{ s.name }}</title>
        </circle>
        <!-- 首末站标记 -->
        <circle v-if="svgStops.length" :cx="svgStops[0].x" :cy="svgStops[0].y" r="5" fill="#fb7185" />
        <circle v-if="svgStops.length > 1" :cx="svgStops[svgStops.length - 1].x" :cy="svgStops[svgStops.length - 1].y" r="5" fill="#fb7185" />
        <!-- 实时车辆 -->
        <g v-for="b in svgBuses" :key="b.id">
          <circle :cx="b.x" :cy="b.y" r="6" fill="#22d3ee" stroke="#0b1020" stroke-width="2">
            <title>{{ b.name }} {{ b.speed }}km/h</title>
          </circle>
        </g>
      </svg>
      <view class="schematic-legend">
        <text class="legend-item"><text class="dot stop"></text>站点</text>
        <text class="legend-item"><text class="dot bus"></text>实时车辆</text>
        <text class="legend-item"><text class="dot end"></text>首/末站</text>
      </view>
    </view>

    <!-- 左上角：线路号搜索 + 上下行快捷切换 -->
    <view class="ctrl">
      <view class="ctrl-search">
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
        <view class="ctrl-cfg" @click="goSettings" title="地图服务设置">⚙</view>
      </view>
      <view class="ctrl-dir">
        <view class="dir-tab" :class="{ active: direction === 0 }" @click="switchDir(0)">上行</view>
        <view class="dir-tab" :class="{ active: direction === 1 }" @click="switchDir(1)">下行</view>
        <view class="dir-cur">{{ lineName ? lineName + ' 路' : '未选择线路' }}</view>
        <!-- 所属营运公司（由在线车辆自编号首位推断）：紧跟线路号后方并行显示 -->
        <view class="ctrl-org" v-if="operatorCompanies.length">
          <view class="org-tag" v-for="c in operatorCompanies" :key="c.no">
            <text class="org-no">{{ c.no }}</text>
            <text class="org-name">{{ c.label }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 右侧车辆面板（可折叠） -->
    <view class="panel" :class="{ collapsed: panelCollapsed }">
      <view class="panel-header">
        <view class="panel-title">实时车辆（{{ buses.length }}辆）</view>
        <view class="header-actions">
          <button class="refresh-btn" @click="loadLive" :disabled="loading">
            {{ loading ? '刷新中' : '刷新' }}
          </button>
          <view class="collapse-btn" :class="{ folded: panelCollapsed }" @click="panelCollapsed = !panelCollapsed" :title="panelCollapsed ? '展开' : '折叠'">▾</view>
        </view>
      </view>
      <view class="panel-body" v-show="!panelCollapsed">
        <scroll-view class="bus-list" scroll-y v-if="buses.length">
          <view class="bus-item" v-for="(bus, i) in buses" :key="i">
            <view class="bus-left">
              <!-- ★ 自编号（由 MD5 加密值还原，如 3240） -->
              <view class="bus-org">{{ bus.orgId || '未知' }}</view>
              <view class="bus-hash">{{ bus.busNo }}</view>
            </view>
            <view class="bus-right">
              <view class="bus-speed">⚡ {{ bus.gpsSpeed }} km/h</view>
              <view class="bus-time">🕐 {{ bus.time }}</view>
            </view>
          </view>
        </scroll-view>
        <view class="empty" v-else>当前没有在线车辆</view>
      </view>
    </view>
  </view>
</template>

<script>
import { fetchRealTime, fetchLine, decryptBusId, onBusIdReady } from '../../utils/api.js'
import { APP_CONFIG, buildLineCode, hasMapKey } from '../../config.js'
import { assetUrl } from '../../utils/asset.js'

export default {
  data() {
    return {
      lineCode: '',
      direction: 0,
      lineName: '',
      // 搜索框输入的线路号
      searchNo: '',
      buses: [],
      loading: false,
      // 地图重建键：uni-app H5 的 callout 浮层在标记更新/清空时会泄漏残留，每次刷新后 +1 强制重建地图
      mapKey: 0,
      // 右侧面板折叠状态
      panelCollapsed: false,
      mapCenter: { lat: 30.5, lng: 114.2 },
      // 示意图相关
      stops: [],
      // 道路吸附后的线路轨迹点（站点间用高德路径规划生成，替代站点直线连接）
      routePoints4Map: [],
      svgW: 300,
      svgH: 420,
      svgStops: [],
      svgBuses: [],
      routePoints: '',
    }
  },
  computed: {
    // 配置了地图 Key（用户自定义 BYOK 或内置）才使用原生地图，否则走示意图
    useMap() {
      return hasMapKey()
    },
    // 地图标记：站点（圆点 + 站名常显）+ 车辆；用 computed 以便自编号字典就绪后自动刷新
    markers() {
      const STOP_ID = 5000
      const stopMarkers = (this.stops || [])
        .map((s, i) => {
          const raw = { lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }
          // API 坐标已是 GCJ-02，直接使用，切勿再转（否则整体偏移数百米）
          const p = isNaN(raw.lat) || isNaN(raw.lng) ? null : { lat: raw.lat, lng: raw.lng, name: s.stopName, i }
          return p
        })
        .filter(Boolean)
        .map((p) => ({
          id: STOP_ID + p.i,
          latitude: p.lat,
          longitude: p.lng,
          title: p.name,
          iconPath: assetUrl('/static/stop-dot.png'),
          width: 14,
          height: 14,
          label: {
            content: p.name,
            color: '#312e81',
            fontSize: 10,
            borderRadius: 6,
            bgColor: 'rgba(255, 255, 255, 0.88)',
            padding: 3,
            textAlign: 'center',
          },
        }))
      const busMarkers = this.buses.map((b, i) => {
        // 营运公司：由自编号首位推断（1 → 武汉公交集团第一公司）
        const cn = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']
        const d = String(b.orgId || '').charAt(0)
        const company = d >= '1' && d <= '9' ? `武汉公交集团${cn[Number(d)]}公司` : '未知公司'
        // 行驶状态：到站 / 行驶 / 停靠
        const state = b.arrived === '1' ? '到站' : (parseFloat(b.gpsSpeed) > 0 ? '行驶' : '停靠')
        // API 坐标已是 GCJ-02，直接使用；键名必须是 latitude/longitude（否则地图内部 LngLat 报错会中断后续渲染）
        return {
          id: i,
          latitude: b.lat,
          longitude: b.lng,
          title: `${this.lineName} ${b.orgId || ''}`.trim(),
          iconPath: assetUrl('/static/bus-live.png'),
          width: 34,
          height: 34,
          callout: {
            // 顺序：身份 → 动态状态 → 归属；标签用全角空格补齐 4 字宽，冒号纵向对齐
            content: `线路号　：${this.lineName}\n自编号　：${b.orgId || '未知'}\n行驶状态：${state}\n车速　　：${b.gpsSpeed}km/h\n当前时间：${b.time}\n所属公司：${company}`,
            display: 'ALWAYS',
            textAlign: 'left',
            fontSize: 11,
            borderRadius: 10,
            bgColor: 'rgba(79, 70, 229, 0.78)',
            color: '#ffffff',
            padding: 8,
          },
        }
      })
      // 站点在下、车辆在上
      return [...stopMarkers, ...busMarkers]
    },
    // 营运走向：优先用高德官方线路真实轨迹，取不到时回退站点直线（外描边 + 主线箭头，贴近官方观感）
    polylines() {
      let points
      if (this.routePoints4Map.length > 1) {
        points = this.routePoints4Map
      } else {
        // API 坐标已是 GCJ-02，直接用于连线
        points = (this.stops || [])
          .map((s) => ({ latitude: parseFloat(s.latitude), longitude: parseFloat(s.longitude) }))
          .filter((p) => !isNaN(p.latitude) && !isNaN(p.longitude))
      }
      if (points.length < 2) return []
      return [
        { points, color: '#3730a3', width: 9, arrowLine: false }, // 深色外描边
        { points, color: '#6366f1', width: 5, arrowLine: true },  // 主线路带方向箭头
      ]
    },
    // 所属营运公司：由当前方向在线车辆自编号（orgId）首位推断，1 → 武汉公交集团第一营运公司，依次类推
    operatorCompanies() {
      const cn = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']
      const set = new Set()
      ;(this.buses || []).forEach((b) => {
        const d = String(b.orgId || '').charAt(0)
        if (d >= '1' && d <= '9') set.add(Number(d))
      })
      return [...set]
        .sort((a, b) => a - b)
        .map((no) => ({ no, label: `武汉公交集团${cn[no]}营运公司` }))
    },
  },
  onLoad(options) {
    this.lineCode = options.lineCode || ''
    this.direction = Number(options.direction || 0)
    this.lineName = options.lineName || ''
    this.searchNo = this.lineName
    this.loadLine()
    this.loadLive()
    // 编号字典就绪后刷新自编号显示
    onBusIdReady(() => {
      this.buses = this.buses.map((b) => ({
        ...b,
        orgId: decryptBusId(b.busId) || b.orgId || '',
      }))
      // 气泡内容变化同样会残留旧浮层，重建地图
      this.mapKey++
      this.renderSchematic()
    })
  },
  methods: {
    // 搜索框“查询”：在当前页直接切换到输入的线路（保持当前方向）
    doSearchMap() {
      const no = (this.searchNo || '').trim()
      if (!no) {
        uni.showToast({ title: '请输入线路号', icon: 'none' })
        return
      }
      this.loadByLine(no, this.direction)
    },
    // 上/下行切换：同一线路换方向重载
    switchDir(dir) {
      if (dir === this.direction) return
      this.loadByLine(this.lineName, dir)
    },
    // 在当前页加载指定线路与方向（重建轨迹/站点/实时车辆）
    loadByLine(no, dir) {
      this.lineName = no
      this.direction = dir
      this.lineCode = buildLineCode(no, dir)
      // 清空上一条线路的轨迹与车辆，避免叠加
      this.routePoints4Map = []
      this.buses = []
      this.stops = []
      this.mapKey++
      this.loadLine()
      this.loadLive()
    },
    // 加载线路站点（用于示意图与走向规划）
    async loadLine() {
      try {
        const data = await fetchLine(this.lineCode)
        this.stops = (data && data.stopDetailList) || []
        // 地图中心移到线路中段，保证切线路时新走向可见（无在线车辆时尤其需要）
        if (this.stops.length) {
          const mid = this.stops[Math.floor(this.stops.length / 2)]
          const mla = parseFloat(mid.latitude), mln = parseFloat(mid.longitude)
          if (!isNaN(mla) && !isNaN(mln)) this.mapCenter = { lat: mla, lng: mln }
        }
        this.renderSchematic()
        this.planRouteAlongRoads()
      } catch (e) {
        this.stops = []
      }
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
    // 跳转地图服务设置页（BYOK：用户自填高德 Key）
    goSettings() {
      uni.navigateTo({ url: '/pages/settings/settings' })
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
    // 生成线路轨迹：优先高德官方公交线路真实轨迹，取不到再回退逐段驾车吸附
    async planRouteAlongRoads() {
      if (!this.useMap) return
      try {
        const AMap = await this.waitForAMap()
        const official = await this.fetchOfficialLinePath(AMap)
        if (official && official.length > 1) {
          this.routePoints4Map = official
          this.mapKey++
          return
        }
        // 官方线路查不到（如线路名不匹配/无公交服务权限）→ 逐段驾车吸附兵底
        await this.planByDriving(AMap)
      } catch (e) {
        // 保持直线回退，不打扰用户
      }
    },
    // 高德官方公交线路真实轨迹：LineSearch 按线路名搜索，用首站坐标就近匹配方向，返回 GCJ-02 轨迹点
    fetchOfficialLinePath(AMap) {
      return new Promise(async (resolve) => {
        const stops = this.stops || []
        if (!stops.length || !this.lineName) return resolve(null)
        const ok = await this.loadPlugin(AMap, 'AMap.LineSearch')
        if (!ok) return resolve(null)
        let settled = false
        const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } }
        const timer = setTimeout(() => done(null), 10000)
        try {
          const ls = new AMap.LineSearch({ city: '武汉', citylimit: true, types: 'BUS' })
          // 首站坐标（已是 GCJ-02），用于就近匹配正确方向
          const firstGcj = { lat: parseFloat(stops[0].latitude), lng: parseFloat(stops[0].longitude) }
          const toXY = (p) => ({ lng: typeof p.getLng === 'function' ? p.getLng() : p.lng, lat: typeof p.getLat === 'function' ? p.getLat() : p.lat })
          ls.search(this.lineName, (status, result) => {
            if (status !== 'complete') return done(null)
            const lines = (result && (result.lineInfo || result.lineList)) || []
            if (!lines.length) return done(null)
            // 选路径起点距首站最近的那条（区分上下行方向）
            let line = null, best = Infinity
            for (const l of lines) {
              const p0 = l.path && l.path[0]
              if (!p0) continue
              const xy = toXY(p0)
              const d = (xy.lat - firstGcj.lat) ** 2 + (xy.lng - firstGcj.lng) ** 2
              if (d < best) { best = d; line = l }
            }
            if (!line) line = lines[0]
            const pts = (line.path || []).map(toXY).map((xy) => ({ latitude: xy.lat, longitude: xy.lng }))
              .filter((p) => !isNaN(p.latitude) && !isNaN(p.longitude))
            done(pts.length > 1 ? pts : null)
          })
        } catch (e) { done(null) }
      })
    },
    // 回退方案：相邻站点逐段驾车路径规划吸附到道路（单段失败只回退那一小段）
    async planByDriving(AMap) {
      // API 坐标已是 GCJ-02，直接喂给驾车规划
      const pts = (this.stops || [])
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
      this.routePoints4Map = result
      this.mapKey++
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
    // 加载实时车辆（标记与连线由 computed 自动生成）
    async loadLive() {
      this.loading = true
      // 先清空上一批车辆，让地图移除旧标记，避免旧位置气泡残留叠加
      this.buses = []
      await this.$nextTick()
      try {
        const data = await fetchRealTime(this.lineCode)
        const list = (data && data.lineBusDtoList) || []
        const buses = []
        list.forEach((b) => {
          const lat = parseFloat(b.latitude)
          const lng = parseFloat(b.longitude)
          if (isNaN(lat) || isNaN(lng)) return
          // 还原加密车辆编号
          const orgId = decryptBusId(b.busId)
          buses.push({
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
        this.buses = buses
        // 聚焦地图到首辆车位置（API 坐标已是 GCJ-02）
        if (buses.length) {
          this.mapCenter = { lat: buses[0].lat, lng: buses[0].lng }
        }
        // 重建地图组件，彻底清除上一批标记与气泡残留
        this.mapKey++
        this.renderSchematic()
      } catch (e) {
        this.buses = []
      } finally {
        this.loading = false
      }
    },
    // 绘制线路示意图：把经纬度线性投影到 SVG 画布
    renderSchematic() {
      const stops = this.stops || []
      const buses = this.buses || []
      if (!stops.length && !buses.length) return

      const points = stops
        .map(s => ({ lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }))
        .filter(p => !isNaN(p.lat) && !isNaN(p.lng))
      const busPts = buses.map(b => ({ lat: b.lat, lng: b.lng }))
      const all = points.concat(busPts)
      if (!all.length) return

      const minLat = Math.min(...all.map(p => p.lat))
      const maxLat = Math.max(...all.map(p => p.lat))
      const minLng = Math.min(...all.map(p => p.lng))
      const maxLng = Math.max(...all.map(p => p.lng))
      const spanLat = maxLat - minLat || 0.001
      const spanLng = maxLng - minLng || 0.001

      // 按纬度做经度收缩修正（武汉约 30.5°，cos≈0.86），使形状比例接近真实地图
      const latScale = Math.cos((minLat + maxLat) / 2 * Math.PI / 180) || 1
      const ratio = (spanLat * latScale) / spanLng

      // 依据数据长宽比动态调整画布高度，让线路尽量填满可视区域
      const pad = 24
      this.svgW = 300
      this.svgH = Math.round(Math.min(560, Math.max(220, this.svgW * ratio)))
      const w = this.svgW - pad * 2
      const h = this.svgH - pad * 2

      const project = (p) => ({
        x: pad + ((p.lng - minLng) / spanLng) * w,
        y: pad + ((maxLat - p.lat) / spanLat) * h,
      })

      this.svgStops = stops.map(s => {
        const { x, y } = project({ lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) })
        return { id: s.stopId, name: s.stopName, x, y }
      })
      this.routePoints = this.svgStops.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      this.svgBuses = buses.map((b, i) => {
        const { x, y } = project({ lat: b.lat, lng: b.lng })
        return { id: i, name: b.orgId || b.busNo, speed: b.gpsSpeed, x, y }
      })
    },
    onMarkerTap(e) {
      const id = e.markerId
      // 站点标记（id 偏移 5000）
      if (id >= 5000) {
        const s = this.stops[id - 5000]
        if (s) uni.showToast({ title: `站点：${s.stopName}`, icon: 'none' })
        return
      }
      const bus = this.buses[id]
      if (bus) {
        uni.showToast({
          title: `车辆 ${bus.orgId || bus.busNo}，${bus.gpsSpeed}km/h`,
          icon: 'none',
        })
      }
    },
    formatGpsTime(t) {
      if (!t || t.length !== 14) return '--'
      return `${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}`
    },
  },
}
</script>

<style>
.page {
  position: relative;
  width: 100%;
  height: 100vh;
}
.map {
  width: 100%;
  height: 100vh;
}
/* 示意图模式 */
.schematic {
  width: 100%;
  height: 100vh;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 20rpx;
}
.schematic-tip {
  font-size: 22rpx;
  color: #fcd34d;
  background: rgba(251, 191, 36, 0.14);
  border: 2rpx solid rgba(251, 191, 36, 0.3);
  border-radius: 999rpx;
  padding: 8rpx 24rpx;
  margin-bottom: 12rpx;
}
/* 示意图模式下的配置引导链接 */
.tip-link {
  color: #22d3ee;
  font-weight: 700;
  text-decoration: underline;
  margin-left: 12rpx;
  cursor: pointer;
}
.route-svg {
  flex: 1;
  width: 100%;
  min-height: 0;
}
.schematic-legend {
  display: flex;
  gap: 32rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.65);
  margin-top: 12rpx;
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
.dot.stop { background: #818cf8; }
.dot.bus { background: #22d3ee; }
.dot.end { background: #fb7185; }
/* 左上角控制卡：线路号搜索 + 上下行切换 */
.ctrl {
  position: absolute;
  top: 24rpx;
  left: 24rpx;
  width: 720rpx;
  max-width: calc(100vw - 48rpx);
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  z-index: 10;
}
.ctrl-search {
  display: flex;
  align-items: center;
  background: rgba(11, 16, 32, 0.72);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 999rpx;
  padding: 8rpx 8rpx 8rpx 24rpx;
  box-shadow: 0 12rpx 36rpx rgba(0, 0, 0, 0.35);
}
.ctrl-icon {
  font-size: 28rpx;
  margin-right: 12rpx;
}
.ctrl-input {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: #fff;
  background: transparent;
  border: none;
}
.ctrl-ph {
  color: rgba(255, 255, 255, 0.4);
}
.ctrl-go {
  flex-shrink: 0;
  font-size: 26rpx;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border-radius: 999rpx;
  padding: 12rpx 30rpx;
  cursor: pointer;
}
/* 地图设置入口（齿轮） */
.ctrl-cfg {
  flex-shrink: 0;
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 30rpx;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.08);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  margin-left: 10rpx;
  cursor: pointer;
  transition: transform 0.25s, background 0.2s;
}
.ctrl-cfg:hover {
  background: rgba(129, 140, 248, 0.3);
  transform: rotate(60deg);
}
.ctrl-dir {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8rpx;
  background: rgba(11, 16, 32, 0.72);
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  border: 2rpx solid rgba(255, 255, 255, 0.16);
  border-radius: 999rpx;
  padding: 8rpx;
  width: fit-content;
  box-shadow: 0 12rpx 36rpx rgba(0, 0, 0, 0.35);
}
.dir-tab {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.7);
  padding: 10rpx 30rpx;
  border-radius: 999rpx;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.dir-tab.active {
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  font-weight: 700;
}
.dir-cur {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.55);
  padding: 0 20rpx;
}
/* 营运公司徽标：嵌入方向行内，靠右与线路号并行 */
.ctrl-org {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  align-items: center;
  margin-left: auto;
}
.org-tag {
  display: inline-flex;
  align-items: center;
  background: rgba(251, 191, 36, 0.12);
  border: 2rpx solid rgba(251, 191, 36, 0.35);
  border-radius: 999rpx;
  padding: 2rpx 18rpx 2rpx 2rpx;
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
  color: #fcd34d;
}
/* 右侧面板（毛玻璃，悬浮在地图上方） */
.panel {
  position: absolute;
  top: 24rpx;
  right: 24rpx;
  width: 560rpx;
  max-height: 60vh;
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
/* 窄屏（手机）回落为底部横栏 */
@media (max-width: 720px) {
  .panel {
    top: auto;
    left: 20rpx;
    right: 20rpx;
    bottom: 20rpx;
    width: auto;
    max-height: 46vh;
  }
}
.panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}
/* 折叠态：去掉底部锚定，高度收缩为仅标题栏 */
.panel.collapsed {
  bottom: auto;
}
.panel.collapsed .panel-header {
  margin-bottom: 0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
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
.panel-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #fff;
}
.refresh-btn {
  font-size: 24rpx;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
  border-radius: 999rpx;
  padding: 10rpx 32rpx;
  line-height: 1.6;
  height: auto;
  box-shadow: 0 8rpx 20rpx rgba(6, 182, 212, 0.35);
}
.bus-list {
  flex: 1;
  min-height: 0;
  width: 100%;
}
/* 窄屏时列表限高，配合底部横栏布局 */
@media (max-width: 720px) {
  .panel.collapsed {
    max-height: none;
    /* 手机上折叠后仍锚定屏幕底部 */
    bottom: 20rpx;
  }
  .bus-list {
    max-height: 32vh;
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
</style>