<template>
  <view class="db-mod" :class="{ plain: plain }">
    <!-- 头部卡：标题 + 三态统计 + 搜索 + 前缀/状态筛选 -->
    <view class="db-row db-head">
      <view class="db-head-text">
        <view class="db-title">线路数据库</view>
        <view class="db-sub">全市线路 · 集团 / 蔡城 / 木兰 / 汉奇 · 本地摘要 · 含已停运历史线</view>
      </view>
      <text class="db-count">共 {{ total }} 条</text>
    </view>

    <view class="db-div"></view>

    <view class="db-row db-stat">
      <view class="db-st"><text class="db-st-n live">{{ stats.live }}</text><text class="db-st-l">营运中</text></view>
      <view class="db-st"><text class="db-st-n ended">{{ stats.ended }}</text><text class="db-st-l">已收班</text></view>
      <view class="db-st"><text class="db-st-n off">{{ stats.off }}</text><text class="db-st-l">已停运</text></view>
    </view>

    <view class="db-div"></view>

    <view class="db-row db-search">
      <text class="db-search-icon">🔍</text>
      <input
        class="db-search-input"
        v-model="kw"
        type="text"
        placeholder="搜索线路号 / 起讫站，如 337 / 武昌火车站"
        placeholder-class="db-search-ph"
      />
      <text class="db-search-clear" v-if="kw" @click="kw = ''">✕</text>
    </view>

    <!-- 公司筛选：按营运主体归并。集团下属各分公司、org 未收录的历史线，
         以及 数字 / 电 / BRT / K / D 等号段统一归「公交集团」，不再裸露成看似独立的分类 -->
    <view class="db-filter">
      <text class="db-fl">公司</text>
      <view class="db-chips">
        <view
          v-for="o in orgOpts"
          :key="o.key"
          class="db-chip"
          :class="{ on: org === o.key }"
          @click="org = o.key"
        >{{ o.label }}</view>
      </view>
    </view>

    <!-- 选中「公交集团」后才展开集团内部的线路号段细分 -->
    <view class="db-filter" v-if="org === 'JT'">
      <text class="db-fl">号段</text>
      <view class="db-chips">
        <view
          v-for="p in groupPrefixes"
          :key="p.key"
          class="db-chip"
          :class="{ on: prefix === p.key }"
          @click="prefix = p.key"
        >{{ p.label }}</view>
      </view>
    </view>

    <!-- 集团内部营运公司细分：仅在公司选「公交集团」时出现，按一…九公司 + 未收录分档 -->
    <view class="db-filter" v-if="org === 'JT'">
      <text class="db-fl">营运公司</text>
      <view class="db-chips">
        <view
          v-for="o in jtOrgOpts"
          :key="o.key"
          class="db-chip"
          :class="{ on: jtOrg === o.key }"
          @click="jtOrg = o.key"
        >{{ o.label }}<text v-if="o.count != null" class="db-chip-n"> {{ o.count }}</text></view>
      </view>
    </view>

    <view class="db-filter">
      <text class="db-fl">状态</text>
      <view class="db-chips">
        <view
          v-for="s in statusOpts"
          :key="s.key"
          class="db-chip"
          :class="{ on: status === s.key }"
          @click="status = s.key"
        >{{ s.label }}</view>
      </view>
    </view>

    <!-- 结果列表 -->
    <view class="db-mod db-list" :class="{ plain: plain }" ref="listRoot">
      <view class="db-row db-lhead">
        <text class="db-lh-t">匹配 {{ filtered.length }} 条</text>
        <CopyPill v-if="filtered.length" label="导出" @copy="copyFiltered" />
        <text class="db-lh-s" v-if="filtered.length">按线路号排序</text>
      </view>
      <view class="db-div"></view>

      <view class="db-item" v-for="l in visibleLines" :key="l.no" @click="openDetail(l)">
        <image class="db-org-logo" :src="orgLogo(l)" mode="aspectFit" />
        <text class="db-no">{{ l.no }}</text>
        <view class="db-item-body">
          <view class="db-route">
            <text class="rt-tag rt-start">起</text>
            <text class="rt-name">{{ l.start || '起点未知' }}</text>
            <text class="rt-arrow">→</text>
            <text class="rt-tag rt-end">终</text>
            <text class="rt-name">{{ l.end || '终点未知' }}</text>
          </view>
          <text class="db-meta">{{ orgLabel(l) ? orgLabel(l) + ' · ' : '' }}{{ l.stops ? l.stops + ' 站' : '站数未知' }} · {{ l.dirs.length > 1 ? '双向' : '单向' }} · {{ l.price ? '¥' + l.price : '票价未知' }}{{ l.realtime === false ? ' · 静态数据' : '' }}</text>
        </view>
        <text class="db-badge" :class="'db-badge-' + statusOf(l).key">{{ statusOf(l).label }}</text>
        <FavStar :line="l" small />
        <text class="db-go">›</text>
      </view>

      <view class="db-none" v-if="!filtered.length">
        <text class="db-none-t">没有符合条件的线路</text>
      </view>
      <!-- 分页：替代「加载更多」；页码记忆到本机，下次打开回到同一页 -->
      <view class="db-pager" v-if="pageCount > 1">
        <view class="db-pg-size">
          <text class="db-pg-size-label">📄 每页</text>
          <view
            v-for="n in pageSizeOpts"
            :key="n"
            class="db-pg-size-opt"
            :class="{ on: pageSize === n }"
            @click="setSize(n)"
          >{{ n }}</view>
        </view>
        <view class="db-pg-arrow" :class="{ dis: page <= 1 }" @click="gotoPage(page - 1)">⬅️ 上一页</view>
        <view class="db-pg-nums">
          <view
            v-for="(p, i) in pageList"
            :key="i"
            class="db-pg-num"
            :class="{ on: p === page, gap: p === '…' }"
            @click="gotoPage(p)"
          >{{ p }}</view>
        </view>
        <view class="db-pg-arrow" :class="{ dis: page >= pageCount }" @click="gotoPage(page + 1)">下一页 ➡️</view>
      </view>
    </view>

    <!-- 详情弹层（只展示本地已有摘要） -->
    <view class="db-mask" v-if="detail" @click="closeDetail"></view>
    <view class="db-pop" v-if="detail" :class="'st-' + statusOf(detail).key">
      <view class="db-pop-head">
        <text class="db-pop-no">{{ detail.no }}</text>
        <text class="db-badge" :class="'db-badge-' + statusOf(detail).key">{{ statusOf(detail).label }}</text>
        <text class="db-pop-close" @click="closeDetail">✕</text>
      </view>
      <view class="db-pop-route">
        <text class="pr-dot pr-start" title="起点站"></text>
        <text class="pr-name" :title="detail.start || '起点未知'">{{ detail.start || '起点未知' }}</text>
        <text class="pr-arrow">{{ detail.dirs && detail.dirs.length > 1 ? '⇄' : '→' }}</text>
        <text class="pr-name" :title="detail.end || '终点未知'">{{ detail.end || '终点未知' }}</text>
        <text class="pr-dot pr-end" title="终点站"></text>
      </view>
      <view class="db-pop-grid">
        <view class="db-cell"><text class="db-k">首班</text><text class="db-v">{{ detail.early || '未知' }}</text></view>
        <view class="db-cell"><text class="db-k">末班</text><text class="db-v">{{ detail.last || '未知' }}</text></view>
        <view class="db-cell"><text class="db-k">票价</text><text class="db-v">{{ detail.price ? '¥' + detail.price : '未知' }}</text></view>
        <view class="db-cell"><text class="db-k">站数</text><text class="db-v">{{ detail.stops ? detail.stops + ' 站' : '未知' }}</text></view>
        <view class="db-cell"><text class="db-k">方向</text><text class="db-v">{{ detail.dirs.length > 1 ? '双向' : '单向' }}</text></view>
        <view class="db-cell"><text class="db-k">名称</text><text class="db-v">{{ detail.name || detail.no }}</text></view>
        <view class="db-cell db-cell-wide"><text class="db-k">营运公司</text><text class="db-v">{{ companyFull(detail) }}</text></view>
      </view>
      <view class="db-pop-note" v-if="statusOf(detail).key === 'off'">
        {{ offNote(detail) }}
      </view>
      <view class="db-pop-note" v-if="detail.realtime === false">
        该线路来自高德公交数据，提供站点与走向，但不含实时车辆与发车计划。
      </view>
      <view class="db-pop-btns">
        <FavStar v-if="detail" :line="detail" />
        <view class="db-pbtn primary" v-if="detail.status !== '停运'" @click="openLive">📡 在实时查询中打开</view>
      </view>
    </view>
  </view>
</template>

<script>
import { allLines, linePrefix, lineStatus } from '../utils/lineIndex.js'
import { companyOf, orgInfo } from '../utils/companies.js'
import { buildLineCode } from '../config.js'
import { copyTable } from '../utils/clipboard.js'
import { assetUrl } from '../utils/asset.js'
import FavStar from './FavStar.vue'
import CopyPill from './CopyPill.vue'
import { closeAllDropdowns } from '../utils/dropdown.js'
import { PAGE_SIZE_OPTS, getPageSize, setPageSize, pageCount as calcPageCount, pageList as calcPageList, clampPage } from '../utils/pagination.js'

// 页码记忆：本地保存上次停留的页（用户要求下次打开仍从第 N 页开始）
const PAGE_KEY = 'whbis:linedb-page'
function readPage() {
  try {
    const n = Number(uni.getStorageSync(PAGE_KEY))
    return n >= 1 ? Math.floor(n) : 1
  } catch (e) { return 1 }
}
function writePage(n) {
  try { uni.setStorageSync(PAGE_KEY, n) } catch (e) { /* 隐私模式写不进去就只影响记忆，不影响功能 */ }
}

export default {
  name: 'LineDb',
  components: { FavStar, CopyPill },
  props: {
    // 裸形态：挂在地图悬浮窗（FloatWin）里时，窗壳只有一张，头卡与列表卡不再各自套玻璃卡
    plain: { type: Boolean, default: false },
  },
  data() {
    return {
      all: [],
      kw: '',
      // 集团内部号段细分：仅在公司选「公交集团」时出现，不再与营运公司并排裸露
      prefix: '全部',
      groupPrefixes: [
        { key: '全部', label: '全部' },
        { key: '数字', label: '数字' },
        { key: '电', label: '电' },
        { key: 'BRT', label: 'BRT' },
        { key: 'K', label: 'K' },
        { key: 'D', label: 'D' },
        { key: 'YX', label: 'YX 夜行' },
      ],
      status: '全部',
      org: '全部',
      // 集团内部营运公司细分：仅在公司选「公交集团」时出现，按一…九公司分档
      jtOrg: '全部',
      statusOpts: [
        { key: '全部', label: '全部' },
        { key: 'live', label: '营运中' },
        { key: 'ended', label: '已收班' },
        { key: 'off', label: '已停运' },
      ],
      page: 1,
      // 每页条数由用户选择（10/20/50/100），全站记忆
      pageSize: getPageSize(),
      pageSizeOpts: PAGE_SIZE_OPTS,
      detail: null,
    }
  },
  computed: {
    total() {
      return this.all.length
    },
    // 三态统计：对全库跑一次 lineStatus（当前时刻），供头部展示
    stats() {
      const s = { live: 0, ended: 0, off: 0 }
      for (const l of this.all) s[lineStatus(l).key]++
      return s
    },
    // 公司筛选项：按营运主体归并。集团下属一…九公司、org 未收录的历史线，
    // 以及 数字 / 电 / BRT / K / D 等集团号段，全部归入「公交集团」一档；
    // 只把实际独立营运的蔡城 / 木兰 / 汉奇单列，避免把分公司误解成不同公司。
    orgOpts() {
      const cnt = {}
      for (const l of this.all) {
        const k = companyOf(l).key
        cnt[k] = (cnt[k] || 0) + 1
      }
      const defs = [
        { key: 'JT', label: '公交集团' },
        { key: 'CC', label: '蔡城公交' },
        { key: 'ML', label: '木兰公交' },
        { key: 'HQ', label: '汉奇公交' },
      ]
      return [{ key: '全部', label: '全部' }, ...defs.filter((d) => cnt[d.key])]
    },
    // 集团内部营运公司细分：从 org 全名里提取「第X营运公司」，org 缺失的线归「未收录」
    jtOrgOpts() {
      const cnt = {}
      for (const l of this.all) {
        if (companyOf(l).key !== 'JT') continue
        const info = orgInfo(l)
        const k = (info && info.label) ? info.label : '未收录'
        cnt[k] = (cnt[k] || 0) + 1
      }
      // 按一…九公司自然序排，未收录放最后
      const order = ['一公司', '二公司', '三公司', '四公司', '五公司', '六公司', '七公司', '八公司', '九公司']
      const sorted = Object.keys(cnt).sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b)
        if (ia >= 0 && ib >= 0) return ia - ib
        if (ia >= 0) return -1
        if (ib >= 0) return 1
        return a.localeCompare(b, 'zh-CN')
      })
      return [{ key: '全部', label: '全部', count: null },
        ...sorted.map((k) => ({ key: k, label: k, count: cnt[k] }))]
    },
    filtered() {
      const q = this.kw.trim().toUpperCase()
      return this.all.filter((l) => {
        const company = companyOf(l).key
        if (this.org !== '全部' && company !== this.org) return false
        // 号段细分只在「公交集团」档生效（其它公司线路本就按号段归属，无需再分）
        if (company === 'JT' && this.prefix !== '全部' && linePrefix(l.no) !== this.prefix) return false
        // 营运公司细分：同在「公交集团」档，org 全名匹配「第X营运公司」
        if (company === 'JT' && this.jtOrg !== '全部') {
          const info = orgInfo(l)
          const sub = (info && info.label) ? info.label : '未收录'
          if (sub !== this.jtOrg) return false
        }
        if (this.status !== '全部' && lineStatus(l).key !== this.status) return false
        if (q) {
          const hay = `${l.no} ${l.name || ''} ${l.start || ''} ${l.end || ''}`.toUpperCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
    },
    // 总页数 / 当前页切片 / 页码按钮（复用全站分页工具）
    pageCount() {
      return calcPageCount(this.filtered.length, this.pageSize)
    },
    visibleLines() {
      const start = (this.page - 1) * this.pageSize
      return this.filtered.slice(start, start + this.pageSize)
    },
    pageList() {
      return calcPageList(this.pageCount, this.page)
    },
  },
  watch: {
    // 换筛选条件回到第 1 页（避免停在越界页看到空列表）
    kw() { this.page = 1 },
    prefix() { this.page = 1 },
    status() { this.page = 1 },
    org() {
      this.prefix = '全部' // 换公司时清掉集团号段细分，避免回到「公交集团」时沿用旧条件
      this.jtOrg = '全部' // 换公司时清掉营运公司细分
      this.page = 1
    },
    jtOrg() { this.page = 1 },
    // 结果变少导致当前页越界时，夹回最后一个有效页
    pageCount() { this.clampPage() },
  },
  // ⚠ 组件不触发页面生命周期：原来写成 onLoad 会永远不执行，列表恒空
  created() {
    this.all = allLines()
    this.page = readPage()
  },
  methods: {
    statusOf(l) {
      return lineStatus(l)
    },
    // 公司 Logo / 名称：按号段统一判定，org「未收录」的集团历史线也有集团徽标
    orgLogo(l) {
      return assetUrl(companyOf(l).logo)
    },
    orgLabel(l) {
      return companyOf(l).label
    },
    companyFull(l) {
      return companyOf(l).full
    },
    // 停运说明按依据分级：公告 / 人工确认 / 接口推断 / 待复核，别把四者说成同一件事
    offNote(l) {
      const base = '该线路已无站点数据，后端不提供逐站明细，仅保留以上摘要信息。'
      if (!l.statusSource) return '该线路已无站点数据（已停运 / 历史线），后端不提供逐站明细，仅保留以上摘要信息。'
      if (l.statusSource === '公告' || l.statusSource === '人工确认') {
        const official = l.statusSource === '公告'
        return [
          official ? '公告 / 权威资料确认停运' : '人工复核确认停运',
          l.stopDate ? '停运日期 ' + l.stopDate : '',
          l.statusNote ? (official ? '来源：' : '依据：') + l.statusNote : '',
          base,
        ].filter(Boolean).join(' · ')
      }
      if (l.statusSource === '待复核') {
        return [
          '注意：停运标记待人工复核',
          l.statusNote || '',
          '暂不提供实时查询入口，确认后需人工修正状态',
        ].filter(Boolean).join(' · ')
      }
      return ['接口推断：双方向均无站点、车辆与发车计划，暂无停运公告佐证', base].join(' · ')
    },
    // 一键复制当前筛选命中的全部线路（TSV：编号/起点/终点/站数/方向/票价/首班/末班/状态/营运公司/停运依据）。
    // 不含 lineCode：那是后端内部编码，对外清单里没有意义（用户 2026-11-09 要求去掉）。
    // 复制的是 filtered 全量（不是当前分页的 visibleLines），粘进表格即成清单
    copyFiltered() {
      const list = this.filtered
      if (!list.length) {
        uni.showToast({ title: '没有符合条件的线路', icon: 'none' })
        return
      }
      const rows = list.map((l) => [
        l.no,
        l.start || '未知',
        l.end || '未知',
        l.stops ? l.stops + ' 站' : '未知',
        l.dirs && l.dirs.length > 1 ? '双向' : '单向',
        l.price ? '¥' + l.price : '未知',
        l.early || '未知',
        l.last || '未知',
        this.statusOf(l).label,
        this.companyFull(l),
        l.statusSource ? l.statusSource + (l.stopDate ? '(' + l.stopDate + ')' : '') : '',
      ])
      copyTable({
        title: `线路库匹配 ${list.length} 条`,
        columns: ['编号', '起点', '终点', '站数', '方向', '票价', '首班', '末班', '状态', '营运公司', '停运依据'],
        rows,
        toast: `已复制 ${list.length} 条线路`,
        imageToast: `已导出 ${list.length} 条线路图片`,
        excelToast: `已导出 ${list.length} 条线路 Excel 文件`,
      })
    },
    // 翻页：夹到有效区间 → 记忆到本机 → 滚回列表顶部（落地页与浮窗共用）
    gotoPage(p) {
      if (p === '…' || p == null) return
      const target = clampPage(p, this.pageCount)
      if (target === this.page) return
      this.page = target
      writePage(target)
      this.$nextTick(() => {
        const el = this.$refs.listRoot
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
      })
    },
    // 结果变少（筛选/搜索）导致当前页越界时夹回最后一个有效页
    clampPage() {
      this.page = clampPage(this.page, this.pageCount)
    },
    // 每页条数：切换后回到第 1 页并记忆选择
    setSize(n) {
      this.pageSize = setPageSize(n)
      this.page = 1
    },
    openDetail(l) {
      // 模态详情接管画面：先收掉所有就地菜单，避免遮罩层叠
      closeAllDropdowns()
      this.detail = l
    },
    closeDetail() {
      this.detail = null
    },
    // 营运线：上抛选线事件给宿主页（由 line 页拉取实时详情；停运线无在线数据，不提供此入口）
    openLive() {
      const l = this.detail
      const code = l.code && String(l.code).includes('-') ? l.code : buildLineCode(l.code || l.no, 0)
      this.$emit('pick', {
        lineCode: code,
        lineName: l.no,
        direction: 0,
        startStop: l.start || '',
        endStop: l.end || '',
        companyKey: l.companyKey || '',
        realtime: l.realtime !== false,
      })
      this.closeDetail()
    },
  },
}
</script>

<style scoped>
/* 玻璃卡：与首页同一套语言 */
.db-mod {
  position: relative;
  box-sizing: border-box;
  border-radius: 28rpx;
  background: rgba(17, 22, 33, 0.86);
  backdrop-filter: blur(30px) saturate(170%);
  -webkit-backdrop-filter: blur(30px) saturate(170%);
  border: 2rpx solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 26rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.08);
}
.db-list {
  overflow: hidden;
}
/* 公司 Logo：紧贴线路号左侧，用小尺寸色块区分不同营运主体 */
.db-org-logo {
  flex: 0 0 auto;
  width: 40rpx;
  height: 40rpx;
  border-radius: 10rpx;
}
/* 裸形态：只去掉卡壳，内边距与细线分区照旧（窗体自己留边） */
.db-mod.plain {
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.db-mod.plain + .db-mod.plain {
  margin-top: 22rpx;
}
.db-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.db-div {
  height: 2rpx;
  margin: 0 24rpx;
  background: rgba(255, 255, 255, 0.07);
}
/* 头部 */
.db-head {
  padding: 26rpx 26rpx 22rpx;
}
.db-head-text {
  flex: 1;
  min-width: 0;
}
.db-title {
  font-size: 36rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 1rpx;
}
.db-sub {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.46);
}
.db-count {
  flex: 0 0 auto;
  font-size: 24rpx;
  font-weight: 700;
  color: var(--ac-hi);
}
/* 三态统计 */
.db-stat {
  padding: 20rpx 26rpx;
  gap: 0;
}
.db-st {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}
.db-st-n {
  font-size: 40rpx;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.db-st-n.live { color: #34d399; }
.db-st-n.ended { color: #fbbf24; }
.db-st-n.off { color: #94a3b8; }
.db-st-l {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.5);
}
/* 搜索凹槽 */
.db-search {
  margin: 22rpx 26rpx 6rpx;
  padding: 0 20rpx;
  height: 76rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  border-radius: 18rpx;
}
.db-search-icon {
  font-size: 26rpx;
  opacity: 0.6;
}
.db-search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 27rpx;
  color: #fff;
}
.db-search-ph {
  color: rgba(255, 255, 255, 0.32);
}
.db-search-clear {
  flex: 0 0 auto;
  padding: 0 8rpx;
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.4);
}
/* 筛选行 */
.db-filter {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 14rpx 26rpx;
}
.db-fl {
  flex: 0 0 auto;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.38);
}
.db-chips {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.db-chip {
  height: 52rpx;
  line-height: 52rpx;
  padding: 0 22rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  font-size: 23rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.10);
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, color 0.18s;
}
.db-chip.on {
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
  border-color: rgba(var(--ac-rgb), 0.7);
}
.db-chip-n {
  font-size: 18rpx;
  font-weight: 600;
  opacity: 0.65;
  margin-left: 4rpx;
}
/* 列表 */
.db-lhead {
  padding: 18rpx 26rpx;
}
.db-lh-t {
  font-size: 24rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.82);
}
.db-lh-s {
  margin-left: auto;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.36);
}
.db-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 26rpx;
  box-sizing: border-box;
  cursor: pointer;
  transition: background 0.16s;
}
.db-item:hover {
  background: rgba(255, 255, 255, 0.045);
}
.db-item:active {
  background: rgba(255, 255, 255, 0.075);
}
.db-no {
  flex: 0 0 auto;
  min-width: 96rpx;
  text-align: center;
  padding: 8rpx 14rpx;
  border-radius: 14rpx;
  font-size: 26rpx;
  font-weight: 800;
  color: #062a33;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
  font-variant-numeric: tabular-nums;
}
.db-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.db-route {
  display: flex;
  align-items: center;
  gap: 6rpx;
  font-size: 25rpx;
  color: rgba(255, 255, 255, 0.88);
  overflow: hidden;
  white-space: nowrap;
}
/* 起讫站共用：起点绿 / 终点琥珀，站名各自省略，箭头不压缩 */
.rt-tag {
  flex: 0 0 auto;
  padding: 1rpx 8rpx;
  border-radius: 6rpx;
  font-size: 18rpx;
  font-weight: 800;
  color: #0b1020;
}
.rt-start { background: #22c55e; }
.rt-end { background: #f59e0b; }
.rt-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rt-arrow {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.42);
}
.db-meta {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.4);
}
.db-go {
  flex: 0 0 auto;
  font-size: 32rpx;
  line-height: 1;
  color: rgba(255, 255, 255, 0.28);
}
.db-none {
  padding: 56rpx 26rpx;
  text-align: center;
}
.db-none-t {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.5);
}
/* 分页条：左右翻页 + 页码（当前页高亮），替代原来的「加载更多」 */
.db-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  margin: 8rpx 26rpx 26rpx;
}
.db-pg-size {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  font-size: 20rpx;
  color: #9aa6bd;
}
.db-pg-size-label { margin-right: 2rpx; }
.db-pg-size-opt {
  min-width: 40rpx;
  padding: 6rpx 8rpx;
  text-align: center;
  border-radius: 10rpx;
  background: rgba(120, 160, 220, 0.1);
  cursor: pointer;
}
.db-pg-size-opt.on { background: var(--ac, #6366f1); color: #fff; }
.db-pg-arrow {
  flex: 0 0 auto;
  height: 60rpx;
  padding: 0 16rpx;
  line-height: 54rpx;
  font-size: 24rpx;
  white-space: nowrap;
  text-align: center;
  color: var(--ac-hi);
  border-radius: 14rpx;
  background: rgba(var(--ac-rgb), 0.12);
  border: 2rpx solid rgba(var(--ac-rgb), 0.3);
  cursor: pointer;
}
.db-pg-arrow.dis { opacity: 0.3; pointer-events: none; }
.db-pg-nums {
  flex: 1 1 200rpx;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  overflow-x: auto;
}
.db-pg-num {
  min-width: 56rpx;
  height: 56rpx;
  line-height: 52rpx;
  padding: 0 8rpx;
  text-align: center;
  font-size: 23rpx;
  color: rgba(255, 255, 255, 0.62);
  border-radius: 12rpx;
  cursor: pointer;
}
.db-pg-num:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
.db-pg-num.on {
  color: #fff;
  font-weight: 700;
  background: rgba(var(--ac-rgb), 0.9);
  box-shadow: 0 4rpx 12rpx rgba(var(--ac-rgb), 0.35);
}
.db-pg-num.gap { color: rgba(255, 255, 255, 0.3); cursor: default; background: none; }
/* 窄屏收紧页码，保证左右翻页按钮始终完整可见 */
@media (max-width: 720px) {
  .db-pg-arrow { padding: 0 12rpx; font-size: 22rpx; }
  .db-pg-nums { gap: 4rpx; }
  .db-pg-num { min-width: 44rpx; height: 48rpx; line-height: 44rpx; padding: 0 4rpx; font-size: 20rpx; }
}
/* 状态徽标：营运中翠绿 / 已收班琥珀 / 已停运石板灰（避开上下行方向色） */
.db-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 36rpx;
  padding: 0 16rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  font-size: 20rpx;
  line-height: 1;
  white-space: nowrap;
  font-weight: 700;
  border: 2rpx solid transparent;
}
.db-badge-live {
  color: #34d399;
  background: rgba(16, 185, 129, 0.16);
  border-color: rgba(52, 211, 153, 0.42);
}
.db-badge-ended {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(251, 191, 36, 0.38);
}
.db-badge-off {
  color: #94a3b8;
  background: rgba(100, 116, 139, 0.16);
  border-color: rgba(148, 163, 184, 0.34);
}
/* 详情弹层 */
.db-mask {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 60;
  background: rgba(4, 8, 18, 0.6);
  backdrop-filter: blur(2px);
}
.db-pop {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 61;
  width: 640rpx;
  max-width: 92vw;
  box-sizing: border-box;
  padding: 30rpx 30rpx 26rpx;
  border-radius: 30rpx;
  background: rgba(20, 26, 40, 0.97);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 30rpx 80rpx rgba(0, 0, 0, 0.6);
}
.db-pop-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.db-pop-no {
  min-width: 104rpx;
  text-align: center;
  padding: 8rpx 16rpx;
  border-radius: 16rpx;
  font-size: 34rpx;
  font-weight: 800;
  color: #062a33;
  background: linear-gradient(135deg, #67e8f9, #06b6d4);
  font-variant-numeric: tabular-nums;
}
.db-pop-close {
  margin-left: auto;
  padding: 6rpx 12rpx;
  font-size: 30rpx;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}
.db-pop-route {
  margin-top: 22rpx;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6rpx;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.4;
  color: #fff;
}
.db-pop-route .rt-name {
  white-space: normal;
  overflow: visible;
}
.db-pop-grid {
  margin-top: 24rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}
.db-cell {
  flex: 1 1 calc(50% - 7rpx);
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  background: rgba(255, 255, 255, 0.05);
  border: 2rpx solid rgba(255, 255, 255, 0.08);
}
.db-k {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.42);
}
.db-v {
  font-size: 28rpx;
  font-weight: 700;
  color: #fff;
  word-break: break-all;
}
.db-pop-note {
  margin-top: 22rpx;
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: #cbd5e1;
  background: rgba(100, 116, 139, 0.16);
  border: 2rpx solid rgba(148, 163, 184, 0.28);
}
.db-pop-btns {
  margin-top: 28rpx;
  display: flex;
  gap: 16rpx;
}
.db-pbtn {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  text-align: center;
  border-radius: 18rpx;
  font-size: 26rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.06);
  border: 2rpx solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.db-pbtn.primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--ac), var(--ac-2));
}

/* 统一面板风格：玻璃底 + 顶部强调色发光条 + 搜索凹槽聚焦描边 */
.db-mod:not(.plain) { background: linear-gradient(180deg, rgba(255,255,255,0.065) 0, rgba(255,255,255,0.016) 68rpx, transparent 156rpx), rgba(11, 16, 32, 0.88); border: 2rpx solid rgba(255, 255, 255, 0.16); box-shadow: 0 24rpx 64rpx rgba(0, 0, 0, 0.5), inset 0 1rpx 0 rgba(255, 255, 255, 0.18); border-radius: 32rpx; }
.db-mod:not(.plain)::before { content: ''; position: absolute; top: 0; left: 24rpx; right: 24rpx; height: 4rpx; border-radius: 0 0 6rpx 6rpx; pointer-events: none; z-index: 1; background: linear-gradient(90deg, rgba(var(--ac-rgb), 0.1), rgba(var(--ac-rgb), 0.9) 30%, rgba(var(--ac-rgb), 0.9) 70%, rgba(var(--ac-rgb), 0.1)); box-shadow: 0 0 12rpx rgba(var(--ac-rgb), 0.4); }
.db-search { border-radius: 999rpx; transition: border-color 0.18s, background 0.18s, box-shadow 0.18s; }
.db-search:focus-within { background: rgba(255, 255, 255, 0.09); border-color: rgba(var(--ac-rgb), 0.6); box-shadow: 0 0 0 4rpx rgba(var(--ac-rgb), 0.16); }

/* —— 线路详情弹层：统一车辆详情窗风格（AGENTS.md 悬浮面板 UI 规范） —— */
.db-pop { padding: 0 28rpx 26rpx; border-radius: 32rpx; overflow: hidden;
  background: linear-gradient(180deg, rgba(255,255,255,0.065) 0, rgba(255,255,255,0.016) 68rpx, transparent 156rpx), rgba(11, 16, 32, 0.94);
  border: 2rpx solid rgba(255, 255, 255, 0.16); box-shadow: 0 26rpx 70rpx rgba(0, 0, 0, 0.55), inset 0 1rpx 0 rgba(255, 255, 255, 0.18); }
.db-pop::before { content: ''; position: absolute; top: 0; left: 24rpx; right: 24rpx; height: 4rpx; border-radius: 0 0 6rpx 6rpx; pointer-events: none;
  background: linear-gradient(90deg, rgba(var(--ac-rgb), 0.1), rgba(var(--ac-rgb), 0.9) 30%, rgba(var(--ac-rgb), 0.9) 70%, rgba(var(--ac-rgb), 0.1)); box-shadow: 0 0 12rpx rgba(var(--ac-rgb), 0.4); }
.db-pop.st-live::before { background: linear-gradient(90deg, rgba(52, 211, 153, 0.1), rgba(52, 211, 153, 0.9) 30%, rgba(52, 211, 153, 0.9) 70%, rgba(52, 211, 153, 0.1)); box-shadow: 0 0 12rpx rgba(52, 211, 153, 0.4); }
.db-pop.st-ended::before { background: linear-gradient(90deg, rgba(251, 191, 36, 0.1), rgba(251, 191, 36, 0.9) 30%, rgba(251, 191, 36, 0.9) 70%, rgba(251, 191, 36, 0.1)); box-shadow: 0 0 12rpx rgba(251, 191, 36, 0.4); }
.db-pop.st-off::before { background: linear-gradient(90deg, rgba(148, 163, 184, 0.1), rgba(148, 163, 184, 0.8) 30%, rgba(148, 163, 184, 0.8) 70%, rgba(148, 163, 184, 0.1)); box-shadow: none; }
.db-pop-head { padding: 24rpx 0 18rpx; border-bottom: 1rpx solid rgba(255, 255, 255, 0.06); }
.db-pop-close { width: 56rpx; height: 56rpx; line-height: 56rpx; padding: 0; text-align: center; border-radius: 50%; font-size: 26rpx; color: rgba(255, 255, 255, 0.66); background: rgba(255, 255, 255, 0.08); }
.db-pop-close:hover { color: #fff; background: rgba(255, 255, 255, 0.16); }
.db-pop-close:active { transform: scale(0.92); }
.db-pop-route { margin-top: 0; padding: 16rpx 0 14rpx; flex-wrap: nowrap; gap: 10rpx; min-width: 0; font-size: 26rpx; border-bottom: 1rpx solid rgba(255, 255, 255, 0.06); }
.pr-dot { flex: 0 0 auto; width: 18rpx; height: 18rpx; border-radius: 50%; }
.pr-start { background: #22c55e; box-shadow: 0 0 0 3rpx rgba(34, 197, 94, 0.22); }
.pr-end { background: #f59e0b; box-shadow: 0 0 0 3rpx rgba(245, 158, 11, 0.22); }
.pr-name { flex: 0 1 auto; max-width: 42%; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 700; color: #eef1ff; }
.pr-arrow { flex: 0 0 auto; font-weight: 700; color: var(--ac-text, #a5f3fc); }
.db-pop-grid { margin-top: 0; gap: 0; }
.db-pop-grid .db-cell { box-sizing: border-box; width: 50%; flex: 0 0 50%; min-width: 0; display: flex; flex-direction: column; gap: 8rpx; padding: 18rpx 20rpx; margin: 0; border: none; border-radius: 0; background: transparent; box-shadow: none; border-top: 1rpx solid rgba(255, 255, 255, 0.06); }
.db-pop-grid .db-cell:nth-child(-n+2) { border-top: none; }
.db-pop-grid .db-cell:nth-child(odd) { padding-left: 0; }
.db-pop-grid .db-cell:nth-child(even) { border-left: 1rpx solid rgba(255, 255, 255, 0.06); padding-left: 24rpx; }
.db-pop-grid .db-cell-wide { width: 100%; flex-basis: 100%; padding-left: 0 !important; border-left: none !important; }
.db-pop-grid .db-k { font-size: 19rpx; font-weight: 500; color: rgba(255, 255, 255, 0.4); letter-spacing: 0.5rpx; }
.db-pop-grid .db-v { font-size: 30rpx; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-pop-note { margin-top: 14rpx; border-radius: 20rpx; border-width: 1rpx; background: rgba(255, 255, 255, 0.035); border-color: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.62); }
.db-pop-btns { margin-top: 24rpx; align-items: center; }
.db-pop-btns .db-pbtn { flex: 1; border-radius: 999rpx; padding: 18rpx 0; text-align: center; font-size: 26rpx; font-weight: 700; }
.db-pop-btns .db-pbtn.primary { color: #fff; background: linear-gradient(135deg, var(--ac), var(--ac-2)); border: none; box-shadow: 0 6rpx 18rpx rgba(var(--ac-rgb), 0.35); }
.db-pop-btns .db-pbtn:active { transform: scale(0.97); }

/* 线路编号徽标跟随主题色（取代固定青色渐变）；营运中/已收班/已停运的状态色不变 */
.db-no,
.db-pop-no {
  color: #fff !important;
  background: linear-gradient(135deg, var(--ac), var(--ac-2)) !important;
  box-shadow: 0 4rpx 14rpx rgba(var(--ac-rgb), 0.35), inset 0 1rpx 0 rgba(255, 255, 255, 0.28);
  text-shadow: 0 1rpx 3rpx rgba(0, 0, 0, 0.25);
}
</style>
