/**
 * 全局设置中心（纯本地存储 · 按设备生效，不依赖后端）
 *
 * - 皮肤：仅黑色。H5 下把结果写到 <html data-skin="dark">，全局 CSS 统一深色。
 * - 刷新间隔：手动(0) / 15 / 20 / 30 秒，全站唯一真源（whbis:refresh-default）。
 *   实时线路、地图页、极简站牌、账号与设置里的刷新控件都读写这一份值，
 *   任意一处改动经 onRefreshSecChange 订阅即时同步到其余控件。
 * - 主题色（强调色）：预设色板 + 调色盘自定义。派生出 --ac / --ac-hi / --ac-deep / --ac-text /
 *   --ac-2 / --ac-rgb / --ac2-rgb 一族 CSS 变量挂 <html>，全站按钮 / 页签 / 选中态跟随变色；
 *   默认靛蓝与历史配色逐像素一致。H5 生效（App 端保持默认）。
 * - 用户名（展示名）：按账号本地保存，仅改显示不改登录身份；账号名不可修改。
 * - 登录有效期：会话本体在 auth.js，这里原样转出 get/setSessionDays。
 * - 地图来源：高德（免 Key 标准瓦片）。GCJ-02 栅格，与公交接口同源零纠偏；
 *   仅影响底图，线路轨迹规划仍走高德 Web 服务。
 * - 高德地图 KEY：用户自填 Web端(JS API) Key，自绘模式下拉官方公交真实轨迹让走向更精确；
 *   留空走免 Key 的 OSRM 贴路。
 */
import { normAccount, getSessionDays, setSessionDays } from './auth.js'

export { getSessionDays, setSessionDays }

const SKIN_KEY = 'whbis:skin'
const ACCENT_KEY = 'whbis:accent'
const REFRESH_KEY = 'whbis:refresh-default'
const PROFILE_KEY = 'whbis:profile'
// 导出方式：所有「导出」按钮统一按此档执行（文本 TSV / Excel 文件 / 图片文件）
const COPY_MODE_KEY = 'whbis:copy-mode'

export const SKIN_OPTS = [
  { key: 'dark', label: '黑色' },
]
// 0 = 手动刷新（不自动轮询，仅用户下拉/点刷新时拉取）
// 全站统一档位：设置面板分段 + 各视图下拉共用，避免各存一份造成「设置不同步」
export const REFRESH_DEFAULT_OPTS = [0, 15, 20, 30]
// 下拉统一文案（label / tip），所有刷新胶囊共用一份
export const REFRESH_OPTS = [
  { sec: 0, label: '手动刷新', tip: '点 ↻ 才拉取' },
  { sec: 15, label: '15 秒', tip: '最灵敏' },
  { sec: 20, label: '20 秒', tip: '较灵敏' },
  { sec: 30, label: '30 秒', tip: '省流量' },
]

// ── 主题色（强调色）──

export const DEFAULT_ACCENT = '#6366f1'
// 预设色板：避开上行青蓝 #06B6D4 与下行玫红 #F43F5E（方向配色专用，别让主题色撞上去）
export const ACCENT_PRESETS = [
  // ── 核心 6 档 ──────────────────────────────────────────
  { key: 'indigo', hex: '#6366f1', label: '靛蓝' },
  { key: 'purple', hex: '#a855f7', label: '紫罗兰' },
  { key: 'magenta', hex: '#ec4899', label: '洋红' },
  { key: 'green', hex: '#10b981', label: '翠绿' },
  { key: 'orange', hex: '#f97316', label: '活力橙' },
  { key: 'blue', hex: '#3b82f6', label: '天蓝' },
  // ── 强调高对比 6 档 ─────────────────────────────────────
  { key: 'red', hex: '#ef4444', label: '正红' },
  { key: 'teal', hex: '#14b8a6', label: '青绿' },
  { key: 'violet', hex: '#8b5cf6', label: '深紫' },
  { key: 'sky', hex: '#0ea5e9', label: '湛蓝' },
  { key: 'lime', hex: '#84cc16', label: '荧光绿' },
  { key: 'rose', hex: '#fb7185', label: '玫瑰粉' },
  // ── 暖色 + 中性补充 3 档 ─────────────────────────────────
  { key: 'amber', hex: '#f59e0b', label: '琥珀' },
  { key: 'coral', hex: '#f97092', label: '珊瑚红' },
  { key: 'slate', hex: '#64748b', label: '石板灰' },
  // ── 粉红/薰衣草/金盏/深青系 9 档 ───────────────────────────
  { key: 'pink', hex: '#ec4899', label: '粉红' },
  { key: 'lavender', hex: '#a78bfa', label: '薰衣草' },
  { key: 'marigold', hex: '#fbbf24', label: '金盏' },
  { key: 'deep-cyan', hex: '#0891b2', label: '深青' },
  { key: 'seafoam', hex: '#a7f3d0', label: '海沫绿' },
  { key: 'pale-pink', hex: '#fce7f3', label: '浅粉' },
  { key: 'soft-lavender', hex: '#c4b5fd', label: '柔薰衣' },
  { key: 'peach', hex: '#fed7aa', label: '蜜桃' },
  { key: 'warm-yellow', hex: '#fef08a', label: '暖黄' },
  // ── 绿/橄榄/石绿 9 档 ────────────────────────────────────
  { key: 'stone-green', hex: '#5b8c6f', label: '石绿' },
  { key: 'olive', hex: '#84a98c', label: '橄榄绿' },
  { key: 'tomato', hex: '#ff6b6b', label: '番茄红' },
  { key: 'mint', hex: '#34d399', label: '薄荷绿' },
  { key: 'turquoise', hex: '#22c55e', label: '松石蓝' },
  { key: 'muted-green', hex: '#6b8e6b', label: '灰绿' },
  { key: 'sea-green', hex: '#1abc9c', label: '海绿' },
  { key: 'forest', hex: '#2d5a27', label: '森林绿' },
  { key: 'emerald', hex: '#059669', label: '翡翠绿' },
  // ── 橙/红/棕 10 档 ───────────────────────────────────────
  { key: 'rust-orange', hex: '#c0583a', label: '铁锈橙' },
  { key: 'zinc-light', hex: '#94a3b8', label: '石灰' },
  { key: 'warm-gray', hex: '#78716c', label: '暖灰' },
  { key: 'cool-gray', hex: '#6b7280', label: '冷灰' },
  { key: 'smoke', hex: '#4b5563', label: '烟灰' },
  { key: 'charcoal', hex: '#374151', label: '炭灰' },
  { key: 'truffle', hex: '#6f4e37', label: '松露棕' },
  { key: 'wisteria', hex: '#9f7aea', label: '紫藤' },
  { key: 'berry', hex: '#9d174d', label: '浆果红' },
  { key: 'chocolate', hex: '#5c3a21', label: '巧克力' },
  // ── 深蓝/海军/钴 8 档 ────────────────────────────────────
  { key: 'sea-blue', hex: '#0ea6a8', label: '海蓝' },
  { key: 'pine', hex: '#2d5a4c', label: '松绿' },
  { key: 'crimson', hex: '#dc2626', label: '猩红' },
  { key: 'brick-red', hex: '#9a3434', label: '砖红' },
  { key: 'cobalt', hex: '#1e40af', label: '钴蓝' },
  { key: 'sky-teal', hex: '#0d9488', label: '天青绿' },
  { key: 'warm-apricot', hex: '#fb923c', label: '暖杏' },
  { key: 'silver-gray', hex: '#9ca3af', label: '银灰' },
  // ── 续增 39 档：淡彩/深色调/大地/蓝绿全谱 ───────────────
  { key: 'navy-blue', hex: '#1e3a8a', label: '海军蓝' },
  { key: 'ivory', hex: '#e5e7eb', label: '象牙白' },
  { key: 'midnight', hex: '#1e3a5f', label: '深夜蓝' },
  { key: 'indigo-deep', hex: '#4338ca', label: '深靛蓝' },
  { key: 'warm-brown', hex: '#78350f', label: '暖棕' },
  { key: 'deep-magenta', hex: '#be185d', label: '深洋红' },
  { key: 'honey-gold', hex: '#d97706', label: '蜜金' },
  { key: 'periwinkle', hex: '#a3bffa', label: '长春花' },
  { key: 'celadon', hex: '#ace1a5', label: '瓷青绿' },
  { key: 'mustard', hex: '#ca8a04', label: '芥末黄' },
  { key: 'sand', hex: '#d4a574', label: '沙色' },
  { key: 'khaki', hex: '#a8a29e', label: '卡其' },
  { key: 'taupe', hex: '#8b7355', label: '灰褐' },
  { key: 'sienna', hex: '#a0522d', label: '赭石' },
  { key: 'sage', hex: '#9caf88', label: '鼠尾草绿' },
  { key: 'teal-dark', hex: '#0f766e', label: '深青色' },
  { key: 'cyan-deep', hex: '#0e7490', label: '深青' },
  { key: 'cerulean', hex: '#007ba7', label: '蔚蓝色' },
  { key: 'azure', hex: '#007fff', label: '苍蓝字' },
  { key: 'powder-blue', hex: '#b0e0e6', label: '粉蓝' },
  { key: 'light-sky', hex: '#87ceeb', label: '天青' },
  { key: 'cornflower', hex: '#6495ed', label: '矢车菊蓝' },
  { key: 'royal-blue', hex: '#4169e1', label: '皇家蓝' },
  { key: 'slate-blue', hex: '#6a5acd', label: '石板蓝' },
  { key: 'lavender-blush', hex: '#fff0f5', label: '薰衣草粉' },
  { key: 'misty-rose', hex: '#ffe4e1', label: '蔷薇雾' },
  { key: 'blush', hex: '#ffc0cb', label: '胭脂粉' },
  { key: 'salmon', hex: '#fa8072', label: '鲑鱼红' },
  { key: 'dark-orchid', hex: '#9932cc', label: '暗紫兰' },
  { key: 'orchid', hex: '#da70d6', label: '兰花紫' },
  { key: 'plum', hex: '#8e4585', label: '梅子红' },
  { key: 'thistle', hex: '#d8bfd8', label: '蓟草紫' },
  { key: 'mauve', hex: '#e0b0ff', label: '淡紫红' },
  { key: 'steel-blue', hex: '#4682b4', label: '钢蓝' },
  { key: 'cadet-blue', hex: '#5f9ea0', label: '军校蓝' },
  { key: 'aquamarine', hex: '#7fffd4', label: '海蓝宝石' },
  // ── 柔和淡彩 20 档 ──────────────────────────────
  { key: 'baby-pink', hex: '#fce4ec', label: '婴儿粉' },
  { key: 'pale-lavender', hex: '#ede7f6', label: '淡薰衣' },
  { key: 'pale-mint', hex: '#e8f5e9', label: '淡薄荷' },
  { key: 'pale-sky', hex: '#e1f5fe', label: '淡天蓝' },
  { key: 'pale-lemon', hex: '#fff9c4', label: '淡柠檬' },
  { key: 'pale-peach', hex: '#fff3e0', label: '淡蜜桃' },
  { key: 'pale-blush', hex: '#fce4ec', label: '淡腮红' },
  { key: 'pale-lilac', hex: '#f3e5f5', label: '淡丁香' },
  { key: 'pale-aqua', hex: '#e0f7fa', label: '淡水蓝' },
  { key: 'pale-lime', hex: '#f1f8e9', label: '淡酸橙' },
  { key: 'pale-rose', hex: '#fce4ec', label: '淡玫瑰' },
  { key: 'pale-salmon', hex: '#fff0eb', label: '淡鲑鱼' },
  { key: 'pale-coral', hex: '#ffe8e0', label: '淡珊瑚' },
  { key: 'pale-gold', hex: '#fff8e1', label: '淡金' },
  { key: 'pale-sage', hex: '#f1f8e9', label: '淡鼠尾草' },
  { key: 'pale-sky-blue', hex: '#e3f2fd', label: '淡天青' },
  { key: 'pale-plum', hex: '#f3e5f5', label: '淡梅子' },
  { key: 'pale-champagne', hex: '#fef9e7', label: '淡香槟' },
  { key: 'pale-rosewood', hex: '#fbe9e7', label: '淡红木' },
  { key: 'pale-seafoam', hex: '#e8f5e9', label: '淡海沫' },
  // ── 明亮霓虹 15 档 ──────────────────────────────
  { key: 'neon-pink', hex: '#ff1493', label: '霓虹粉' },
  { key: 'neon-green', hex: '#39ff14', label: '霓虹绿' },
  { key: 'neon-cyan', hex: '#00ffff', label: '霓虹青' },
  { key: 'neon-orange', hex: '#ff6600', label: '霓虹橙' },
  { key: 'neon-purple', hex: '#bf00ff', label: '霓虹紫' },
  { key: 'neon-yellow', hex: '#ffff00', label: '霓虹黄' },
  { key: 'neon-red', hex: '#ff003c', label: '霓虹红' },
  { key: 'neon-blue', hex: '#0066ff', label: '霓虹蓝' },
  { key: 'neon-magenta', hex: '#ff00ff', label: '霓虹洋红' },
  { key: 'neon-lime', hex: '#ccff00', label: '霓虹酸橙' },
  { key: 'neon-turquoise', hex: '#00ffcc', label: '霓虹松石' },
  { key: 'neon-salmon', hex: '#ff8c69', label: '霓虹鲑鱼' },
  { key: 'neon-gold', hex: '#ffd700', label: '霓虹金' },
  { key: 'neon-teal', hex: '#00ff9f', label: '霓虹青绿' },
  { key: 'neon-indigo', hex: '#4b0082', label: '霓虹靛蓝' },
  // ── 深色大地 15 档 ──────────────────────────────
  { key: 'deep-brown', hex: '#3e2723', label: '深棕' },
  { key: 'deep-tan', hex: '#5d4037', label: '深褐' },
  { key: 'deep-umber', hex: '#4e342e', label: '深赭' },
  { key: 'deep-copper', hex: '#6d4c41', label: '深铜' },
  { key: 'deep-burgundy', hex: '#4a0e0e', label: '深酒红' },
  { key: 'deep-maroon', hex: '#4a148c', label: '深栗色' },
  { key: 'deep-olive', hex: '#33691e', label: '深橄榄' },
  { key: 'deep-teal', hex: '#004d40', label: '深青绿' },
  { key: 'deep-navy', hex: '#0a1929', label: '深海军' },
  { key: 'deep-charcoal', hex: '#1a1a1a', label: '深炭' },
  { key: 'deep-slate', hex: '#263238', label: '深石板' },
  { key: 'deep-plum', hex: '#2d1b3e', label: '深梅子' },
  { key: 'deep-rust', hex: '#4a2c17', label: '深铁锈' },
  { key: 'deep-sienna', hex: '#3b1f0b', label: '深赭石' },
  { key: 'deep-espresso', hex: '#1b0f0a', label: '深咖啡' },
  // ── 暖色陶土 10 档 ──────────────────────────────
  { key: 'terracotta', hex: '#c75b39', label: '陶土红' },
  { key: 'burnt-sienna', hex: '#e97451', label: '焦赭' },
  { key: 'raw-sienna', hex: '#c19a6b', label: '生赭' },
  { key: 'sandy-brown', hex: '#f4a460', label: '沙棕' },
  { key: 'peru', hex: '#cd853f', label: '秘鲁棕' },
  { key: 'chocolate-deep', hex: '#4e2f1c', label: '深巧克力' },
  { key: 'cocoa', hex: '#d2691e', label: '可可棕' },
  { key: 'chestnut', hex: '#8b4513', label: '栗色' },
  { key: 'auburn', hex: '#6b3a2a', label: '红棕' },
  { key: 'russet', hex: '#80461b', label: '栗褐' },
  // ── 冷色石板 10 档 ──────────────────────────────
  { key: 'blue-slate', hex: '#607d8b', label: '蓝石板' },
  { key: 'steel', hex: '#455a64', label: '钢灰' },
  { key: 'graphite', hex: '#37474f', label: '石墨' },
  { key: 'asphalt', hex: '#263238', label: '柏油' },
  { key: 'slate-cyan', hex: '#546e7a', label: '石板青' },
  { key: 'slate-blue', hex: '#37474f', label: '石板蓝' },
  { key: 'slate-green', hex: '#455a64', label: '石板绿' },
  { key: 'slate-gray', hex: '#607d8b', label: '石板灰' },
  { key: 'blue-gray', hex: '#78909c', label: '蓝灰' },
  { key: 'warm-slate', hex: '#546e7a', label: '暖石板' },
  // ── 浆果/酒红 10 档 ─────────────────────────────
  { key: 'wine', hex: '#722f37', label: '酒红' },
  { key: 'grape', hex: '#6c3483', label: '葡萄紫' },
  { key: 'plum-deep', hex: '#4a0e4e', label: '深梅子' },
  { key: 'mulberry', hex: '#6b0f4a', label: '桑葚' },
  { key: 'blackberry', hex: '#1a0a2e', label: '黑莓' },
  { key: 'elderberry', hex: '#3d1c5e', label: '接骨木' },
  { key: 'acai', hex: '#4a1c5c', label: '阿萨伊' },
  { key: 'cranberry', hex: '#8b0a2e', label: '蔓越莓' },
  { key: 'raspberry', hex: '#a0245a', label: '覆盆子' },
  { key: 'blackcurrant', hex: '#2d1b4e', label: '黑醋栗' },
  // ── 深林绿 10 档 ────────────────────────────────
  { key: 'forest-deep', hex: '#1b4332', label: '深林绿' },
  { key: 'pine-deep', hex: '#1b3a2d', label: '深松绿' },
  { key: 'moss', hex: '#4a7c59', label: '苔藓绿' },
  { key: 'fern', hex: '#3d5a3e', label: '蕨绿' },
  { key: 'jungle', hex: '#0a3d0a', label: '丛林绿' },
  { key: 'palm', hex: '#1e5631', label: '棕榈绿' },
  { key: 'willow', hex: '#3a6b35', label: '柳绿' },
  { key: 'holly', hex: '#1a3c1a', label: '冬青绿' },
  { key: 'ivy', hex: '#2d5a27', label: '常春藤' },
  { key: 'cedar', hex: '#3e2723', label: '雪松绿' },
  // ── 天空/青色 15 档 ──────────────────────────────
  { key: 'sky-light', hex: '#87ceeb', label: '浅天蓝' },
  { key: 'sky-mid', hex: '#5dade2', label: '中天空' },
  { key: 'sky-deep', hex: '#2e86c1', label: '深天空' },
  { key: 'cyan-bright', hex: '#00e5ff', label: '亮青' },
  { key: 'cyan-deep2', hex: '#006064', label: '深青' },
  { key: 'aqua', hex: '#00ced1', label: '青绿' },
  { key: 'turquoise-light', hex: '#48d1cc', label: '浅松石' },
  { key: 'teal-light', hex: '#26c6da', label: '浅青绿' },
  { key: 'cerulean-light', hex: '#0288d1', label: '浅蔚蓝' },
  { key: 'sapphire', hex: '#0f52ba', label: '蓝宝石' },
  { key: 'dodger', hex: '#1e90ff', label: '道奇蓝' },
  { key: 'cornflower-deep', hex: '#4169e1', label: '深矢车菊' },
  { key: 'medium-blue', hex: '#0000cd', label: '中蓝' },
  { key: 'royal-light', hex: '#4361ee', label: '浅皇家蓝' },
  { key: 'indigo-light', hex: '#5c6bc0', label: '浅靛蓝' },
  // ── 珊瑚/蜜桃 10 档 ─────────────────────────────
  { key: 'coral-light', hex: '#ff7f50', label: '浅珊瑚' },
  { key: 'coral-deep', hex: '#ff4757', label: '深珊瑚' },
  { key: 'salmon-light', hex: '#fa8072', label: '浅鲑鱼' },
  { key: 'apricot', hex: '#fbceb1', label: '杏色' },
  { key: 'melon', hex: '#fdcb6e', label: '甜瓜' },
  { key: 'tangerine', hex: '#ff9f43', label: '橘子' },
  { key: 'persimmon', hex: '#e67e22', label: '柿子' },
  { key: 'papaya', hex: '#ff6348', label: '木瓜' },
  { key: 'guava', hex: '#e74c3c', label: '番石榴红' },
  { key: 'watermelon', hex: '#fd79a8', label: '西瓜红' },
  // ── 奶油/象牙 10 档 ─────────────────────────────
  { key: 'cream', hex: '#fffdd0', label: '奶油' },
  { key: 'ivory-light', hex: '#fffff0', label: '浅象牙' },
  { key: 'beige', hex: '#f5f5dc', label: '米色' },
  { key: 'linen', hex: '#faf0e6', label: '亚麻' },
  { key: 'antique', hex: '#faebd7', label: '古董白' },
  { key: 'navajo', hex: '#ffdead', label: '纳瓦霍白' },
  { key: 'blanched', hex: '#ffebcd', label: '漂白' },
  { key: 'wheat', hex: '#f5deb3', label: '小麦' },
  { key: 'cornsilk', hex: '#fff8dc', label: '玉米丝' },
  { key: 'lemon-chiffon', hex: '#fffacd', label: '柠檬绸' },
  // ── 薰衣草/紫罗兰 15 档 ────────────────────────
  { key: 'lavender-light', hex: '#b8a9c9', label: '浅薰衣' },
  { key: 'lavender-deep', hex: '#9b59b6', label: '深薰衣' },
  { key: 'orchid-light', hex: '#da70d6', label: '浅兰花' },
  { key: 'orchid-deep', hex: '#9932cc', label: '深兰花' },
  { key: 'violet-light', hex: '#8a2be2', label: '浅紫罗兰' },
  { key: 'violet-deep', hex: '#4b0082', label: '深紫罗兰' },
  { key: 'iris', hex: '#5b2c6f', label: '鸢尾紫' },
  { key: 'wisteria-deep', hex: '#6c3483', label: '深紫藤' },
  { key: 'amethyst', hex: '#9966cc', label: '紫水晶' },
  { key: 'grape-light', hex: '#c39bd3', label: '浅葡萄' },
  { key: 'lavender-blush2', hex: '#f8e8ff', label: '薰衣草颊' },
  { key: 'mauve-light', hex: '#e8d0f0', label: '浅淡紫' },
  { key: 'thistle-light', hex: '#d8bfd8', label: '浅蓟草' },
  { key: 'plum-light', hex: '#d8b0d0', label: '浅梅子' },
  { key: 'magenta-light', hex: '#f0a0c0', label: '浅洋红' },
  // ── 薄荷/海沫 10 档 ─────────────────────────────
  { key: 'mint-light', hex: '#b2f5ea', label: '浅薄荷' },
  { key: 'mint-dark', hex: '#0d9488', label: '深薄荷' },
  { key: 'seafoam-light', hex: '#a7f3d0', label: '浅海沫' },
  { key: 'tea-green', hex: '#d0f0c0', label: '茶绿' },
  { key: 'pistachio', hex: '#93c572', label: '开心果' },
  { key: 'kiwi', hex: '#8bc34a', label: '猕猴桃绿' },
  { key: 'honeydew', hex: '#f0fff0', label: '蜜瓜绿' },
  { key: 'light-green', hex: '#90ee90', label: '浅绿' },
  { key: 'pale-green', hex: '#98fb98', label: '苍白绿' },
  { key: 'spring-green', hex: '#00ff7f', label: '春绿' },
  // ── 金色/琥珀 10 档 ─────────────────────────────
  { key: 'gold-light', hex: '#ffd700', label: '浅金' },
  { key: 'gold-deep', hex: '#b8860b', label: '深金' },
  { key: 'amber-light2', hex: '#ffbf00', label: '浅琥珀' },
  { key: 'amber-deep', hex: '#ff8c00', label: '深琥珀' },
  { key: 'honey', hex: '#ffd700', label: '蜂蜜金' },
  { key: 'saffron', hex: '#f4a460', label: '藏红花' },
  { key: 'mustard-light', hex: '#ffdb58', label: '浅芥末' },
  { key: 'marigold-light', hex: '#ffc300', label: '浅金盏' },
  { key: 'topaz', hex: '#ffc87c', label: '黄玉' },
  { key: 'citrine', hex: '#e4d00a', label: '黄晶' },
  // ── 玫瑰/粉色 10 档 ─────────────────────────────
  { key: 'rose-light', hex: '#ffb6c1', label: '浅玫瑰' },
  { key: 'rose-deep', hex: '#c2185b', label: '深玫瑰' },
  { key: 'pink-light', hex: '#ffc0cb', label: '浅粉红' },
  { key: 'pink-deep', hex: '#c71585', label: '深粉红' },
  { key: 'fuchsia', hex: '#ff00ff', label: '品红' },
  { key: 'hot-pink', hex: '#ff69b4', label: '热粉' },
  { key: 'deep-pink', hex: '#ff1493', label: '深粉' },
  { key: 'blush-light', hex: '#ffe4e1', label: '浅腮红' },
  { key: 'salmon-light2', hex: '#fa8072', label: '浅鲑鱼' },
  { key: 'coral-light2', hex: '#ff7f50', label: '浅珊瑚' },
  // ── 深红/猩红 10 档 ─────────────────────────────
  { key: 'crimson-light', hex: '#dc143c', label: '浅猩红' },
  { key: 'scarlet', hex: '#ff2400', label: '猩红' },
  { key: 'cherry', hex: '#de3163', label: '樱桃红' },
  { key: 'ruby', hex: '#9b111e', label: '红宝石' },
  { key: 'garnet', hex: '#733635', label: '石榴石' },
  { key: 'cardinal', hex: '#c41e3a', label: '枢机红' },
  { key: 'vermillion', hex: '#e34234', label: '朱红' },
  { key: 'cinnabar', hex: '#e34234', label: '朱砂' },
  { key: 'tomato-deep', hex: '#ff6347', label: '深番茄' },
  { key: 'red-orange', hex: '#ff4500', label: '红橙' },
  // ── 橄榄/深绿 10 档 ─────────────────────────────
  { key: 'olive-dark', hex: '#556b2f', label: '深橄榄' },
  { key: 'olive-drab', hex: '#6b8e23', label: '橄榄褐' },
  { key: 'forest-green', hex: '#228b22', label: '森林绿' },
  { key: 'hunter-green', hex: '#355e3b', label: '猎人绿' },
  { key: 'emerald-dark', hex: '#046307', label: '深翡翠' },
  { key: 'jade', hex: '#00a86b', label: '翡翠' },
  { key: 'teal-dark2', hex: '#004d40', label: '深青绿' },
  { key: 'cyan-dark', hex: '#008b8b', label: '深青' },
  { key: 'sea-green-deep', hex: '#2e8b57', label: '深海绿' },
  { key: 'medium-sea', hex: '#3cb371', label: '中海绿' },
  // ── 深海军/钴蓝 10 档 ───────────────────────────
  { key: 'navy-deep', hex: '#000080', label: '深海军' },
  { key: 'midnight-blue', hex: '#191970', label: '午夜蓝' },
  { key: 'sapphire-deep', hex: '#0f2b5b', label: '深蓝宝' },
  { key: 'indigo-deep2', hex: '#2e0854', label: '深靛蓝' },
  { key: 'royal-blue-deep', hex: '#1a237e', label: '深皇家蓝' },
  { key: 'cobalt-deep', hex: '#0047ab', label: '深钴蓝' },
  { key: 'steel-blue-deep', hex: '#4682b4', label: '深钢蓝' },
  { key: 'slate-blue-deep', hex: '#483d8b', label: '深石板蓝' },
  { key: 'dark-slate', hex: '#483d8b', label: '深石板' },
  { key: 'deep-indigo', hex: '#1a1a6e', label: '深靛蓝' },
  // ── 钢铁/工业 10 档 ─────────────────────────────
  { key: 'iron', hex: '#696969', label: '铁灰' },
  { key: 'titanium', hex: '#545454', label: '钛灰' },
  { key: 'chrome', hex: '#a9a9a9', label: '铬灰' },
  { key: 'brushed', hex: '#8a8a8a', label: '拉丝' },
  { key: 'gunmetal', hex: '#2c3539', label: '枪金属' },
  { key: 'obsidian', hex: '#1c1c1c', label: '黑曜石' },
  { key: 'onyx', hex: '#353839', label: '黑玛瑙' },
  { key: 'granite', hex: '#676767', label: '花岗岩' },
  { key: 'concrete', hex: '#9ca3af', label: '混凝土' },
  { key: 'stone', hex: '#b0b0b0', label: '石灰' },
  // ── 暖灰/棕灰 10 档 ─────────────────────────────
  { key: 'taupe-light', hex: '#8b7d6b', label: '浅褐灰' },
  { key: 'taupe-deep', hex: '#483c32', label: '深褐灰' },
  { key: 'warm-gray-light', hex: '#a09a94', label: '浅暖灰' },
  { key: 'warm-gray-deep', hex: '#5c534a', label: '深暖灰' },
  { key: 'beige-dark', hex: '#d2b48c', label: '深米色' },
  { key: 'sand-light', hex: '#c2b280', label: '浅沙色' },
  { key: 'sand-deep', hex: '#8b7355', label: '深沙色' },
  { key: 'khaki-dark', hex: '#8b7d6b', label: '深卡其' },
  { key: 'espresso-light', hex: '#6f4e37', label: '浅咖啡' },
  { key: 'mocha', hex: '#6f4e37', label: '摩卡' },
  // ── 亮黄/柠檬 10 档 ─────────────────────────────
  { key: 'lemon', hex: '#fff44f', label: '柠檬黄' },
  { key: 'golden-yellow', hex: '#ffd700', label: '金黄' },
  { key: 'sunflower', hex: '#ffda03', label: '向日葵' },
  { key: 'canary', hex: '#ffef00', label: '金丝雀' },
  { key: 'banana', hex: '#ffe135', label: '香蕉黄' },
  { key: 'maize', hex: '#fbce01', label: '玉米黄' },
  { key: 'amber-light2', hex: '#ffc107', label: '浅琥珀' },
  { key: 'marigold-light', hex: '#ffc300', label: '浅金盏' },
  { key: 'yellow-green', hex: '#9acd32', label: '黄绿' },
  { key: 'chartreuse', hex: '#7fff00', label: '黄绿色' },
  // ── 橙/铜 10 档 ─────────────────────────────────
  { key: 'copper', hex: '#b87333', label: '铜色' },
  { key: 'bronze', hex: '#cd7f32', label: '青铜' },
  { key: 'brass', hex: '#b5a642', label: '黄铜' },
  { key: 'rust-light', hex: '#b7410e', label: '浅铁锈' },
  { key: 'rust-mid', hex: '#8b4513', label: '中铁锈' },
  { key: 'cinnamon', hex: '#d2691e', label: '肉桂' },
  { key: 'caramel', hex: '#af6f47', label: '焦糖' },
  { key: 'burnt-orange', hex: '#cc5500', label: '焦橙' },
  { key: 'amber-orange', hex: '#ff8c00', label: '琥珀橙' },
  { key: 'tangerine-deep', hex: '#ff8c42', label: '深橘子' },
  // ── 青/蓝绿 10 档 ───────────────────────────────
  { key: 'teal-aqua', hex: '#008080', label: '青绿' },
  { key: 'aqua-deep', hex: '#008b8b', label: '深青绿' },
  { key: 'turquoise-deep', hex: '#40e0d0', label: '深松石' },
  { key: 'cyan-deep3', hex: '#008b8b', label: '深青' },
  { key: 'seafoam-deep', hex: '#2e8b8b', label: '深海沫' },
  { key: 'mint-deep', hex: '#00695c', label: '深薄荷' },
  { key: 'jade-deep', hex: '#00695c', label: '深翡翠' },
  { key: 'cyan-dark2', hex: '#006064', label: '深青' },
  { key: 'teal-dark3', hex: '#004d40', label: '深青绿' },
  { key: 'aqua-light', hex: '#e0f7fa', label: '浅青绿' },
  // ── 梅子/紫 10 档 ───────────────────────────────
  { key: 'plum-deep2', hex: '#4a0e4e', label: '深梅子' },
  { key: 'violet-deep2', hex: '#4b0082', label: '深紫罗兰' },
  { key: 'indigo-deep3', hex: '#2e0854', label: '深靛蓝' },
  { key: 'purple-deep', hex: '#4a0e4e', label: '深紫' },
  { key: 'magenta-deep', hex: '#8b008b', label: '深洋红' },
  { key: 'rosewood', hex: '#65000b', label: '红木' },
  { key: 'wine-deep', hex: '#5c0a1a', label: '深酒红' },
  { key: 'berry-deep', hex: '#6b0f4a', label: '深浆果' },
  { key: 'orchid-deep2', hex: '#6a0dad', label: '深兰花' },
  { key: 'lavender-deep2', hex: '#7b2d8e', label: '深薰衣' },
  // ── 珊瑚/桃 10 档 ───────────────────────────────
  { key: 'coral-light2', hex: '#ff8a65', label: '浅珊瑚' },
  { key: 'salmon-deep', hex: '#e85d4a', label: '深鲑鱼' },
  { key: 'peach-deep', hex: '#ff9a76', label: '深蜜桃' },
  { key: 'apricot-deep', hex: '#e8a050', label: '深杏色' },
  { key: 'tangerine-deep2', hex: '#e87c3f', label: '深橘子' },
  { key: 'persimmon-deep', hex: '#c0392b', label: '深柿子' },
  { key: 'papaya-deep', hex: '#e67e22', label: '深木瓜' },
  { key: 'guava-deep', hex: '#c0392b', label: '深番石榴' },
  { key: 'watermelon-deep', hex: '#e74c3c', label: '深西瓜红' },
  { key: 'cranberry-deep', hex: '#8b0a2e', label: '深蔓越莓' },
  // ── 棕褐色调 10 档 ─────────────────────────────
  { key: 'brown', hex: '#a52a2a', label: '棕色' },
  { key: 'saddle', hex: '#8b4513', label: '马鞍棕' },
  { key: 'sienna', hex: '#a0522d', label: '赭石' },
  { key: 'chocolate-brown', hex: '#d2691e', label: '巧克力棕' },
  { key: 'peru-brown', hex: '#cd853f', label: '秘鲁棕' },
  { key: 'burlywood', hex: '#deb887', label: '浅棕' },
  { key: 'tan', hex: '#d2b48c', label: '棕褐' },
  { key: 'roan', hex: '#8d6e63', label: '鹿棕' },
  { key: 'coffe', hex: '#6f4e37', label: '咖啡棕' },
  { key: 'espresso', hex: '#4a2c17', label: '浓缩棕' },
  // ── 橄榄/深绿 10 档 ─────────────────────────────
  { key: 'olive-drab2', hex: '#6b8e23', label: '橄榄褐' },
  { key: 'forest-green2', hex: '#228b22', label: '森林绿' },
  { key: 'hunter-green2', hex: '#355e3b', label: '猎人绿' },
  { key: 'emerald-dark2', hex: '#046307', label: '深翡翠' },
  { key: 'jade2', hex: '#00a86b', label: '翡翠' },
  { key: 'teal-dark4', hex: '#004d40', label: '深青绿' },
  { key: 'cyan-dark3', hex: '#008b8b', label: '深青' },
  { key: 'sea-green-deep2', hex: '#2e8b57', label: '深海绿' },
  { key: 'medium-sea2', hex: '#3cb371', label: '中海绿' },
  { key: 'lime-green', hex: '#32cd32', label: '石灰绿' },
  // ── 深海军/钴蓝 10 档 ───────────────────────────
  { key: 'navy-deep2', hex: '#000080', label: '深海军' },
  { key: 'midnight-blue2', hex: '#191970', label: '午夜蓝' },
  { key: 'sapphire-deep2', hex: '#0f2b5b', label: '深蓝宝' },
  { key: 'indigo-deep4', hex: '#2e0854', label: '深靛蓝' },
  { key: 'royal-blue-deep2', hex: '#1a237e', label: '深皇家蓝' },
  { key: 'cobalt-deep2', hex: '#0047ab', label: '深钴蓝' },
  { key: 'steel-blue-deep2', hex: '#4682b4', label: '深钢蓝' },
  { key: 'slate-blue-deep2', hex: '#483d8b', label: '深石板蓝' },
  { key: 'dark-slate2', hex: '#483d8b', label: '深石板' },
  { key: 'deep-indigo2', hex: '#1a1a6e', label: '深靛蓝' },
  // ── 钢铁/工业 10 档 ─────────────────────────────
  { key: 'iron2', hex: '#696969', label: '铁灰' },
  { key: 'titanium2', hex: '#545454', label: '钛灰' },
  { key: 'chrome2', hex: '#a9a9a9', label: '铬灰' },
  { key: 'brushed2', hex: '#8a8a8a', label: '拉丝' },
  { key: 'gunmetal2', hex: '#2c3539', label: '枪金属' },
  { key: 'obsidian2', hex: '#1c1c1c', label: '黑曜石' },
  { key: 'onyx2', hex: '#353839', label: '黑玛瑙' },
  { key: 'granite2', hex: '#676767', label: '花岗岩' },
  { key: 'concrete2', hex: '#9ca3af', label: '混凝土' },
  { key: 'stone2', hex: '#b0b0b0', label: '石灰' },
  // ── 暖灰/棕灰 10 档 ─────────────────────────────
  { key: 'taupe-light2', hex: '#8b7d6b', label: '浅褐灰' },
  { key: 'taupe-deep2', hex: '#483c32', label: '深褐灰' },
  { key: 'warm-gray-light2', hex: '#a09a94', label: '浅暖灰' },
  { key: 'warm-gray-deep2', hex: '#5c534a', label: '深暖灰' },
  { key: 'beige-dark2', hex: '#d2b48c', label: '深米色' },
  { key: 'sand-light2', hex: '#c2b280', label: '浅沙色' },
  { key: 'sand-deep2', hex: '#8b7355', label: '深沙色' },
  { key: 'khaki-dark2', hex: '#8b7d6b', label: '深卡其' },
  { key: 'espresso-light2', hex: '#6f4e37', label: '浅咖啡' },
  { key: 'mocha2', hex: '#6f4e37', label: '摩卡' },
  // ── 亮黄/柠檬 10 档 ─────────────────────────────
  { key: 'lemon2', hex: '#fff44f', label: '柠檬黄' },
  { key: 'golden-yellow2', hex: '#ffd700', label: '金黄' },
  { key: 'sunflower2', hex: '#ffda03', label: '向日葵' },
  { key: 'canary2', hex: '#ffef00', label: '金丝雀' },
  { key: 'banana2', hex: '#ffe135', label: '香蕉黄' },
  { key: 'maize2', hex: '#fbce01', label: '玉米黄' },
  { key: 'amber-light3', hex: '#ffc107', label: '浅琥珀' },
  { key: 'marigold-light2', hex: '#ffc300', label: '浅金盏' },
  { key: 'yellow-green2', hex: '#9acd32', label: '黄绿' },
  { key: 'chartreuse2', hex: '#7fff00', label: '黄绿色' },
  // ── 橙/铜 10 档 ─────────────────────────────────
  { key: 'copper2', hex: '#b87333', label: '铜色' },
  { key: 'bronze2', hex: '#cd7f32', label: '青铜' },
  { key: 'brass2', hex: '#b5a642', label: '黄铜' },
  { key: 'rust-light2', hex: '#b7410e', label: '浅铁锈' },
  { key: 'rust-mid2', hex: '#8b4513', label: '中铁锈' },
  { key: 'cinnamon2', hex: '#d2691e', label: '肉桂' },
  { key: 'caramel2', hex: '#af6f47', label: '焦糖' },
  { key: 'burnt-orange2', hex: '#cc5500', label: '焦橙' },
  { key: 'amber-orange2', hex: '#ff8c00', label: '琥珀橙' },
  { key: 'tangerine-deep3', hex: '#ff8c42', label: '深橘子' },
  // ── 青/蓝绿 10 档 ───────────────────────────────
  { key: 'teal-aqua2', hex: '#008080', label: '青绿' },
  { key: 'aqua-deep2', hex: '#008b8b', label: '深青绿' },
  { key: 'turquoise-deep2', hex: '#40e0d0', label: '深松石' },
  { key: 'cyan-deep4', hex: '#008b8b', label: '深青' },
  { key: 'seafoam-deep2', hex: '#2e8b8b', label: '深海沫' },
  { key: 'mint-deep2', hex: '#00695c', label: '深薄荷' },
  { key: 'jade-deep2', hex: '#00695c', label: '深翡翠' },
  { key: 'cyan-dark4', hex: '#006064', label: '深青' },
  { key: 'teal-dark5', hex: '#004d40', label: '深青绿' },
  { key: 'aqua-light2', hex: '#e0f7fa', label: '浅青绿' },
  // ── 梅子/紫 10 档 ───────────────────────────────
  { key: 'plum-deep3', hex: '#4a0e4e', label: '深梅子' },
  { key: 'violet-deep3', hex: '#4b0082', label: '深紫罗兰' },
  { key: 'indigo-deep5', hex: '#2e0854', label: '深靛蓝' },
  { key: 'purple-deep2', hex: '#4a0e4e', label: '深紫' },
  { key: 'magenta-deep2', hex: '#8b008b', label: '深洋红' },
  { key: 'rosewood2', hex: '#65000b', label: '红木' },
  { key: 'wine-deep2', hex: '#5c0a1a', label: '深酒红' },
  { key: 'berry-deep2', hex: '#6b0f4a', label: '深浆果' },
  { key: 'orchid-deep3', hex: '#6a0dad', label: '深兰花' },
  { key: 'lavender-deep3', hex: '#7b2d8e', label: '深薰衣' },
  // ── 珊瑚/桃 10 档 ───────────────────────────────
  { key: 'coral-light3', hex: '#ff8a65', label: '浅珊瑚' },
  { key: 'salmon-deep2', hex: '#e85d4a', label: '深鲑鱼' },
  { key: 'peach-deep2', hex: '#ff9a76', label: '深蜜桃' },
  { key: 'apricot-deep2', hex: '#e8a050', label: '深杏色' },
  { key: 'tangerine-deep4', hex: '#e87c3f', label: '深橘子' },
  { key: 'persimmon-deep2', hex: '#c0392b', label: '深柿子' },
  { key: 'papaya-deep2', hex: '#e67e22', label: '深木瓜' },
  { key: 'guava-deep2', hex: '#c0392b', label: '深番石榴' },
  { key: 'watermelon-deep2', hex: '#e74c3c', label: '深西瓜红' },
  { key: 'cranberry-deep2', hex: '#8b0a2e', label: '深蔓越莓' },
  // ── 大地/沙 10 档 ───────────────────────────────
  { key: 'sandstone', hex: '#c2b280', label: '砂岩' },
  { key: 'clay', hex: '#b5651d', label: '黏土' },
  { key: 'ochre', hex: '#cc7722', label: '赭石' },
  { key: 'umber2', hex: '#483c32', label: '赭土' },
  { key: 'raw-umber', hex: '#826644', label: '生赭土' },
  { key: 'desert', hex: '#c19a6b', label: '沙漠' },
  { key: 'dune', hex: '#c2b280', label: '沙丘' },
  { key: 'driftwood', hex: '#8b7d6b', label: '漂流木' },
  { key: 'weathered', hex: '#a09a94', label: '风化' },
  { key: 'dust', hex: '#b0a090', label: '尘土' },
  // ── 灰调 10 档 ──────────────────────────────────
  { key: 'warm-gray2', hex: '#969696', label: '暖灰' },
  { key: 'cool-gray2', hex: '#7a7a7a', label: '冷灰' },
  { key: 'slate-gray2', hex: '#708090', label: '石板灰' },
  { key: 'charcoal2', hex: '#36454f', label: '炭灰' },
  { key: 'ash', hex: '#b2beb5', label: '灰烬' },
  { key: 'fog', hex: '#c8c8c8', label: '雾灰' },
  { key: 'smoke2', hex: '#5a5a5a', label: '烟灰' },
  { key: 'mist', hex: '#d3d3d3', label: '薄雾' },
  { key: 'cloud', hex: '#e8e8e8', label: '云白' },
  { key: 'pearl', hex: '#f0e6e6', label: '珍珠' },
  // ── 粉彩 10 档 ──────────────────────────────────
  { key: 'baby-blue', hex: '#89cff0', label: '婴儿蓝' },
  { key: 'baby-green', hex: '#8fbc8f', label: '婴儿绿' },
  { key: 'baby-yellow', hex: '#fffacd', label: '婴儿黄' },
  { key: 'baby-purple', hex: '#d8bfd8', label: '婴儿紫' },
  { key: 'pastel-pink', hex: '#ffd1dc', label: '粉彩粉' },
  { key: 'pastel-blue', hex: '#b0e0e6', label: '粉彩蓝' },
  { key: 'pastel-green', hex: '#98fb98', label: '粉彩绿' },
  { key: 'pastel-yellow', hex: '#ffffcc', label: '粉彩黄' },
  { key: 'pastel-lavender', hex: '#e6e6fa', label: '粉彩薰' },
  { key: 'pastel-peach', hex: '#ffdab9', label: '粉彩桃' },
  // ── 金属色 10 档 ────────────────────────────────
  { key: 'gold', hex: '#ffd700', label: '金色' },
  { key: 'silver', hex: '#c0c0c0', label: '银色' },
  { key: 'bronze2', hex: '#cd7f32', label: '青铜' },
  { key: 'copper2', hex: '#b87333', label: '铜色' },
  { key: 'brass2', hex: '#b5a642', label: '黄铜' },
  { key: 'steel2', hex: '#b0b0b0', label: '钢色' },
  { key: 'chrome2', hex: '#a9a9a9', label: '铬色' },
  { key: 'nickel', hex: '#a2a2a2', label: '镍色' },
  { key: 'tin', hex: '#b0a090', label: '锡色' },
  { key: 'aluminum', hex: '#c0c0c0', label: '铝色' },
  // ── 花卉/自然 10 档 ─────────────────────────────
  { key: 'rose', hex: '#ff007f', label: '玫瑰' },
  { key: 'lilac', hex: '#c8a2c8', label: '丁香' },
  { key: 'iris2', hex: '#5b2c6f', label: '鸢尾' },
  { key: 'sunflower2', hex: '#ffda03', label: '向日葵' },
  { key: 'daisy', hex: '#fff8dc', label: '雏菊' },
  { key: 'tulip', hex: '#ff6347', label: '郁金香' },
  { key: 'orchid2', hex: '#da70d6', label: '兰花' },
  { key: 'lotus', hex: '#f8c8dc', label: '莲花' },
  { key: 'jasmine', hex: '#f5f5dc', label: '茉莉' },
  { key: 'violet2', hex: '#8a2be2', label: '紫罗兰' },
  // ── 食物色调 10 档 ──────────────────────────────
  { key: 'caramel2', hex: '#af6f47', label: '焦糖' },
  { key: 'honey2', hex: '#ffd700', label: '蜂蜜' },
  { key: 'maple', hex: '#bf4a00', label: '枫糖' },
  { key: 'toffee', hex: '#d2691e', label: '太妃' },
  { key: 'butterscotch', hex: '#f0a050', label: '奶油糖' },
  { key: 'vanilla', hex: '#f3e5ab', label: '香草' },
  { key: 'chocolate2', hex: '#4e2f1c', label: '巧克力' },
  { key: 'cocoa2', hex: '#d2691e', label: '可可' },
  { key: 'coffee2', hex: '#6f4e37', label: '咖啡' },
  { key: 'tea2', hex: '#d0f0c0', label: '茶' },
  // ── 节日/季节 10 档 ─────────────────────────────
  { key: 'christmas-red', hex: '#c41e3a', label: '圣诞红' },
  { key: 'christmas-green', hex: '#0a5c0a', label: '圣诞绿' },
  { key: 'halloween', hex: '#ff6600', label: '万圣橙' },
  { key: 'thanksgiving', hex: '#c47a2a', label: '感恩棕' },
  { key: 'valentine', hex: '#c71585', label: '情人节粉' },
  { key: 'easter', hex: '#f0c0c0', label: '复活节粉' },
  { key: 'summer', hex: '#ffd700', label: '夏日金' },
  { key: 'autumn', hex: '#c47a2a', label: '秋棕' },
  { key: 'winter', hex: '#b0c4de', label: '冬蓝' },
  { key: 'spring', hex: '#90ee90', label: '春绿' },
  // ── 补充 10 档 ──────────────────────────────────
  { key: 'coral2', hex: '#ff7f50', label: '珊瑚' },
  { key: 'salmon2', hex: '#fa8072', label: '鲑鱼' },
  { key: 'peach2', hex: '#ffdab9', label: '蜜桃' },
  { key: 'apricot2', hex: '#fbceb1', label: '杏色' },
  { key: 'gold2', hex: '#ffd700', label: '金色' },
  { key: 'silver2', hex: '#c0c0c0', label: '银色' },
  { key: 'bronze3', hex: '#cd7f32', label: '青铜' },
  { key: 'copper3', hex: '#b87333', label: '铜色' },
  { key: 'rose2', hex: '#ff007f', label: '玫瑰' },
  { key: 'lilac2', hex: '#c8a2c8', label: '丁香' },
]

/**
 * 扩展色：程序化铺满 HSL 色环，补足到总数 999 种。
 * 手工精选项（上面 537 条）全部保留在前；扩展项 key 为 xNNN、label「扩展 NNN」，
 * 每项按 HSL 自动打上 cat 分类标签，融入设置面板现有颜色分类（不再单列「扩展」）。
 * 生成在模块加载时完成（462 次简单 HSL→RGB，耗时可忽略），不写死进源码。
 */
;(function fillAccentTo999() {
  const TARGET = 999
  // hsl → hex：h 0~360、s/l 0~100
  const hslHex = (h, s, l) => {
    s /= 100; l /= 100
    const k = (n) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0')
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`
  }
  // 按 HSL 把扩展色自动归入现有分类（与 map.vue 的 accentCatOptions key 对齐）
  const autoCat = (h, s, l) => {
    if (l <= 32) return 'dark'
    if (s <= 18) return l >= 80 ? 'gray' : 'warmgray'
    if (l >= 86) return 'pastel'
    if (s >= 90 && l >= 55) return 'neon'
    if (h < 15 || h >= 345) return l < 50 ? 'crimson' : 'red'
    if (h < 45) return s < 55 ? 'earth' : (l < 50 ? 'brown' : 'orange')
    if (h < 70) return l < 55 ? 'gold' : 'yellow'
    if (h < 160) {
      if (l < 45) return 'forest'
      if (s < 55) return 'olive'
      return h < 100 ? 'green' : 'mint'
    }
    if (h < 200) return l < 50 ? 'teal' : 'sky'
    if (h < 250) return l < 45 ? 'navy' : 'blue'
    if (h < 290) return s < 50 ? 'plum' : 'lavender'
    return l < 50 ? 'berry' : 'rose'
  }
  const seenHex = new Set(ACCENT_PRESETS.map((p) => p.hex.toLowerCase()))
  let i = 0
  // 12 个色相 × 多档饱和度/明度，循环直到补满；跳过与手工项重复的 hex
  const LIGHTS = [88, 76, 64, 52, 40, 28]
  const SATS = [95, 78, 60, 42]
  outer: for (let round = 0; round < 12; round++) {
    for (const l of LIGHTS) {
      for (const s of SATS) {
        for (let hue = 0; hue < 360; hue += 30) {
          if (ACCENT_PRESETS.length >= TARGET) break outer
          const h = (hue + round * 7) % 360
          const hex = hslHex(h, s, l)
          if (seenHex.has(hex)) continue
          seenHex.add(hex)
          i++
          ACCENT_PRESETS.push({
            key: `x${String(i).padStart(3, '0')}`, hex,
            label: `扩展 ${String(i).padStart(3, '0')}`,
            cat: autoCat(h, s, l),
          })
        }
      }
    }
  }
})()

/** 规范成 #rrggbb 小写；非法输入返回 null */
function normHex(v) {
  let s = String(v == null ? '' : v).trim().toLowerCase()
  if (s.charAt(0) !== '#') s = '#' + s
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
  return /^#[0-9a-f]{6}$/.test(s) ? s : null
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  let h = 0
  let s = 0
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, s * 100, l * 100]
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0; let g = 0; let b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c } else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c } else if (h < 300) { r = x; b = c } else { r = c; b = x }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return '#' + to(r) + to(g) + to(b)
}

/**
 * 由基准色派生全站强调色变量族：
 * - ac 基准 / hi 提亮（浅文字、描边）/ deep 压暗（hover、渐变深端）/ text 浅色文字
 * - ac2 渐变搭档色（基准色相 -52°，默认靛蓝恰好落在历史用的青色端）
 * - rgb / rgb2 供 rgba(var(--ac-rgb), α) 写法
 * 默认靛蓝直接返回历史常量，保证与既有视觉逐像素一致。
 */
export function accentScale(hex) {
  const base = normHex(hex) || DEFAULT_ACCENT
  if (base === DEFAULT_ACCENT) {
    return {
      ac: '#6366f1', hi: '#818cf8', deep: '#4f46e5', text: '#c7d2fe',
      ac2: '#06b6d4', rgb: '99, 102, 241', rgb2: '6, 182, 212',
    }
  }
  const [h, s, l] = rgbToHsl(...hexToRgb(base))
  const cl = (v, lo, hi2) => Math.max(lo, Math.min(hi2, v))
  const h2 = (h + 308) % 360 // -52°：冷色系搭档（靛蓝→青），暖色系也得带邻近过渡的渐变端
  return {
    ac: base,
    hi: hslToHex(h, s, cl(l + 8, 60, 92)),
    deep: hslToHex(h, cl(s - 4, 30, 100), cl(l - 12, 28, 60)),
    text: hslToHex(h, s, cl(l + 21, 70, 90)),
    ac2: hslToHex(h2, s, cl(l, 35, 70)),
    rgb: hexToRgb(base).join(', '),
    rgb2: hexToRgb(hslToHex(h2, s, cl(l, 35, 70))).join(', '),
  }
}

export function getAccent() {
  return normHex(readRaw(ACCENT_KEY, DEFAULT_ACCENT)) || DEFAULT_ACCENT
}

/** 把主题色变量族应用到 <html>（App.vue 全局 CSS 与各组件 var() 据此变色） */
export function applyAccent(hex) {
  // #ifdef H5
  try {
    const sc = accentScale(hex)
    const st = document.documentElement.style
    st.setProperty('--ac', sc.ac)
    st.setProperty('--ac-hi', sc.hi)
    st.setProperty('--ac-deep', sc.deep)
    st.setProperty('--ac-text', sc.text)
    st.setProperty('--ac-2', sc.ac2)
    st.setProperty('--ac-rgb', sc.rgb)
    st.setProperty('--ac2-rgb', sc.rgb2)
  } catch (e) { /* 忽略 */ }
  // #endif
}

/** 落库 + 应用，返回生效色 */
export function setAccent(hex) {
  const n = normHex(hex)
  if (n) {
    writeRaw(ACCENT_KEY, n)
    applyAccent(n)
  }
  return getAccent()
}

/** 仅应用不落库（调色盘拖动时的实时预览；cancel 时回退也走它） */
export function previewAccent(hex) {
  applyAccent(hex)
}

/** JS 侧取主题色 rgba 字符串（marker 标签底色等 CSS 变量够不到的场景） */
export function accentRgba(alpha) {
  const [r, g, b] = hexToRgb(getAccent())
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
function readRaw(key, fallback) {
  try {
    const v = uni.getStorageSync(key)
    return v === '' || v == null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function writeRaw(key, v) {
  try {
    uni.setStorageSync(key, v)
  } catch (e) { /* 存储不可用时仅本次生效 */ }
}

// ── 皮肤 ──

export function getSkin() {
  const v = readRaw(SKIN_KEY, 'dark')
  return SKIN_OPTS.some((o) => o.key === v) ? v : 'dark'
}

/** 当前皮肤：仅黑色，直接返回存储值（默认 dark） */
export function resolvedSkin() {
  return getSkin()
}

/** 把当前皮肤应用到文档根节点（App.vue 的全局 CSS 据此换肤） */
export function applySkin() {
  // #ifdef H5
  try {
    document.documentElement.dataset.skin = 'dark'
  } catch (e) { /* 忽略 */ }
  // #endif
}

/** 皮肤仅黑色，无需监听系统深浅色切换 */
export function watchSystemSkin() {}

export function setSkin(skin) {
  writeRaw(SKIN_KEY, 'dark')
  applySkin()
  return getSkin()
}

// ── 刷新间隔（秒）：全站唯一真源 ──
// 旧版「实时线路 / 地图页各存一份」会让同一份设置在不同按钮上显示不同值，且设置面板
// 改了默认值后已手动选过的视图不跟随。现在统一读写 REFRESH_KEY，并广播给所有订阅者。
const _refreshListeners = new Set()
// 旧键：首次读取时迁移到真源；setRefreshSec 也会镜像写，兼容仍在读旧键的探针/旧代码
const LEGACY_REFRESH_KEYS = ['whbis:line-refresh-sec', 'whbis:map-refresh-sec']

function normalizeRefreshSec(sec) {
  const v = Number(sec)
  return REFRESH_DEFAULT_OPTS.includes(v) ? v : 15
}

export function getRefreshSec() {
  const raw = readRaw(REFRESH_KEY, '')
  if (raw !== '' && raw != null) return normalizeRefreshSec(raw)
  // 真源没写过 → 从旧键做一次性迁移，命中即写回真源（旧键保留，便于回滚）
  for (const key of LEGACY_REFRESH_KEYS) {
    const old = readRaw(key, '')
    if (old !== '' && old != null) {
      const v = normalizeRefreshSec(old)
      writeRaw(REFRESH_KEY, v)
      return v
    }
  }
  return 15
}

export function setRefreshSec(sec) {
  const v = normalizeRefreshSec(sec)
  writeRaw(REFRESH_KEY, v)
  LEGACY_REFRESH_KEYS.forEach((key) => writeRaw(key, v))
  _refreshListeners.forEach((cb) => {
    try { cb(v) } catch (e) { /* 单个订阅者异常不影响其它控件 */ }
  })
  return v
}

// 订阅刷新间隔变化，返回取消订阅函数（组件卸载时调用，避免泄漏）
export function onRefreshSecChange(cb) {
  if (typeof cb !== 'function') return () => {}
  _refreshListeners.add(cb)
  return () => _refreshListeners.delete(cb)
}

// 兼容旧命名：语义已从「各视图的默认值」升级为「全站统一值」
export const getRefreshDefault = getRefreshSec
export const setRefreshDefault = setRefreshSec

// ── 导出方式（全站统一）──
// text = TSV 纯文本写入剪贴板；excel = 下载真正的 .xlsx 文件；image = 下载 .png 文件（手机可用）
// 没有设置面板入口：档位就在每个导出胶囊（components/CopyPill.vue）右半的下拉里，
// 任一处切换经 onCopyModeChange 广播，其余胶囊即时跟随。
// 顺序即下拉里的排列：纯文本 → Excel → 图片（由轻到重）。
// short 用于导出胶囊右半的档位标签（一行放得下），label 用于下拉与提示。
export const COPY_MODE_OPTS = [
  { key: 'text', label: '复制为纯文本', short: '文本', note: 'TSV 表格，可粘进 Excel' },
  { key: 'excel', label: '导出为 Excel 文件', short: 'Excel', note: '下载 .xlsx 文件，Excel / WPS 可直接打开' },
  { key: 'image', label: '导出为图片文件', short: '图片', note: '下载 .png 图片，带生成时间，手机同样可用' },
]

function normalizeCopyMode(v) {
  return COPY_MODE_OPTS.some((o) => o.key === v) ? v : 'text'
}

export function getCopyMode() {
  return normalizeCopyMode(readRaw(COPY_MODE_KEY, 'text'))
}

// 订阅者：全站每个复制胶囊都挂一个，任一处切换档位，其余按钮的档位标签即时跟随
const _copyListeners = new Set()

export function setCopyMode(key) {
  const v = normalizeCopyMode(key)
  writeRaw(COPY_MODE_KEY, v)
  _copyListeners.forEach((cb) => {
    try { cb(v) } catch (e) { /* 单个订阅者异常不影响其它控件 */ }
  })
  return v
}

// 订阅复制方式变化，返回取消订阅函数（组件卸载时调用，避免泄漏）
export function onCopyModeChange(cb) {
  if (typeof cb !== 'function') return () => {}
  _copyListeners.add(cb)
  return () => _copyListeners.delete(cb)
}

// 说明：非集团线路（蔡城 / 木兰 / 汉奇）已并入全站线路库，默认全部可查询搜索，
// 不再提供「其它公交公司」开关；相关存储键与设置订阅机制已移除。

// ── 用户名（展示名）：账号名是登录主键不可改，用户名只是本地展示层 ──

function readProfile() {
  let v
  try {
    v = uni.getStorageSync(PROFILE_KEY)
  } catch (e) {
    return {}
  }
  if (!v) return {}
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch (e) { return {} }
  }
  return v && typeof v === 'object' ? v : {}
}

/** 该账号的用户名；未设置返回 ''（UI 回退显示账号名） */
export function getDisplayName(account) {
  const row = readProfile()[normAccount(account)]
  return (row && row.name) || ''
}

/** 保存用户名（trim 后最多 16 字；传空即清除，回退显示账号名） */
export function setDisplayName(account, name) {
  const n = String(name == null ? '' : name).trim().slice(0, 16)
  const k = normAccount(account)
  if (!k) return ''
  const p = readProfile()
  if (n) p[k] = { ...(p[k] || {}), name: n }
  else if (p[k]) {
    delete p[k].name
    if (!Object.keys(p[k]).length) delete p[k]
  }
  writeRaw(PROFILE_KEY, p)
  return n
}

// ── 界面字体 ──
// 内置多款「OFL / 免费商用」开源字体，webfont 按需分片加载：
// CSS 用 unicode-range 把整字库切成上百个小 woff2，浏览器只下载页面实际
// 用到的字形分片（首屏通常几十 KB），不用的字重/生僻字一分都不拉。
// 全部走 jsDelivr CDN；加载失败时 family 栈会回退到系统字体，UI 永远可读。
// 仅 H5 生效（App 端保持系统默认，与主题色的平台约束一致）。

const FONT_KEY = 'whbis:ui-font'

/** 默认档 key 与历史系统字体栈（App.vue page 的 font-family 与它逐字一致） */
export const DEFAULT_FONT = 'system'
export const BASE_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', " +
  "'Source Han Sans CN', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', Roboto, " +
  'Helvetica, Arial, sans-serif'

const FS5 = 'https://cdn.jsdelivr.net/npm/@fontsource/'
const LGW = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/'
const LGW_LITE = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-lite-webfont@1.6.0/'
const LGW_SCREEN = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.6.0/'
// 厂商免费商用字体（小米 MiSans / 华为 HarmonyOS Sans），同样是 unicode-range 分片
const MISANS = 'https://cdn.jsdelivr.net/npm/misans@5.0.0/lib/Normal/'
const HARMONY = 'https://cdn.jsdelivr.net/npm/harmonyos-sans-sc-webfont-splitted@1.1.0/dist/'
// cn-fontsource 系列：社区把免费商用字体切成分片 woff2，单包只含一个 font.css
const CNFS = 'https://cdn.jsdelivr.net/npm/'

/**
 * 字体档位：css 为需要注入的 <link> 列表；family 为该字体在 CSS 里的 font-family 名。
 * 排序按「日常可用度」：系统默认 → 正文字体（黑/宋/楷）→ 圆体 → 书法展示体。
 * 全部 SIL OFL / 厂商免费商用；CSS 均为 unicode-range 分片，只下载页面用到的字形。
 */
export const FONT_OPTS = [
  { key: 'system', label: '系统默认', note: '跟随系统 · 零加载', family: '', css: [] },
  {
    key: 'wenkai', label: '霞鹜文楷', note: '楷体 · 温润易读', family: "'LXGW WenKai'",
    css: [LGW + 'lxgwwenkai-regular.css', LGW + 'lxgwwenkai-bold.css'],
  },
  {
    key: 'wenkai-screen', label: '霞鹜文楷·屏显', note: '加粗优化 · 更适合屏幕', family: "'LXGW WenKai Screen'",
    css: [LGW_SCREEN + 'lxgwwenkaiscreen.css', LGW_SCREEN + 'lxgwwenkaiscreenr.css'],
  },
  {
    key: 'wenkai-lite', label: '霞鹜文楷·精简', note: '轻量版 · 加载更快', family: "'LXGW WenKai Lite'",
    css: [LGW_LITE + 'lxgwwenkailite-regular.css', LGW_LITE + 'lxgwwenkailite-bold.css'],
  },
  {
    key: 'noto-sans', label: '思源黑体', note: '现代黑体 · 端正', family: "'Noto Sans SC'",
    css: [FS5 + 'noto-sans-sc@5.1.0/400.css', FS5 + 'noto-sans-sc@5.1.0/500.css', FS5 + 'noto-sans-sc@5.1.0/700.css'],
  },
  {
    key: 'noto-serif', label: '思源宋体', note: '衬线宋体 · 文艺', family: "'Noto Serif SC'",
    css: [FS5 + 'noto-serif-sc@5.1.0/400.css', FS5 + 'noto-serif-sc@5.1.0/700.css'],
  },
  {
    key: 'misans', label: 'MiSans 小米', note: '现代黑体 · 大气', family: "'MiSans'",
    css: [MISANS + 'MiSans-Regular.min.css', MISANS + 'MiSans-Medium.min.css', MISANS + 'MiSans-Bold.min.css'],
  },
  {
    key: 'harmony', label: '鸿蒙黑体', note: 'HarmonyOS · 科技感', family: "'HarmonyOS Sans SC'",
    css: [HARMONY + 'Regular.css', HARMONY + 'Medium.css', HARMONY + 'Bold.css'],
  },
  {
    key: 'neo-xihei', label: '霞鹜新晰黑', note: '屏幕黑体 · 清晰大气', family: "'LXGW Neo XiHei'",
    css: [CNFS + 'cn-fontsource-lxgw-neo-xi-hei-regular@1.0.1/font.css'],
  },
  {
    key: 'xiaowei', label: '站酷小薇体', note: '复古宋体 · 秀气', family: "'ZCOOL XiaoWei'",
    css: [FS5 + 'zcool-xiaowei@5.1.0/400.css'],
  },
  {
    key: 'qingke', label: '站酷庆科黄油体', note: '圆润粗体 · 标题感', family: "'ZCOOL QingKe HuangYou'",
    css: [FS5 + 'zcool-qingke-huangyou@5.1.0/400.css'],
  },
  {
    key: 'kuaile', label: '站酷快乐体', note: '圆润手写 · 活泼', family: "'ZCOOL KuaiLe'",
    css: [FS5 + 'zcool-kuaile@5.1.0/400.css'],
  },
  {
    key: 'mashan', label: '马善政楷书', note: '毛笔楷书 · 飘逸', family: "'Ma Shan Zheng'",
    css: [FS5 + 'ma-shan-zheng@5.1.0/400.css'],
  },
  {
    key: 'longcang', label: '龙藏体', note: '行书手写 · 洒脱', family: "'Long Cang'",
    css: [FS5 + 'long-cang@5.1.0/400.css'],
  },
  {
    key: 'zhimang', label: '志莽行书', note: '行草 · 洒脱奔放', family: "'Zhi Mang Xing'",
    css: [FS5 + 'zhi-mang-xing@5.1.0/400.css'],
  },
  {
    key: 'liujian', label: '柳建毛草', note: '草书 · 写意', family: "'Liu Jian Mao Cao'",
    css: [FS5 + 'liu-jian-mao-cao@5.1.0/400.css'],
  },
  {
    key: 'smiley', label: '得意黑', note: '潮流标题 · 动感', family: "'Smiley Sans Oblique'",
    css: [CNFS + 'cn-fontsource-smiley-sans-oblique-regular@1.0.1/font.css'],
  },
  {
    key: 'dingtalk', label: '钉钉进步体', note: '标题感 · 现代', family: "'DingTalk JinBuTi'",
    css: [CNFS + 'cn-fontsource-ding-talk-jin-bu-ti-regular@1.0.3/font.css'],
  },
  {
    key: 'noto-sans-hinted', label: '思源柔黑', note: '柔润黑体 · 舒适易读', family: "'Noto Sans SC Hinted'",
    css: [FS5 + 'noto-sans-sc-hinted@5.2.0/400.css', FS5 + 'noto-sans-sc-hinted@5.2.0/700.css'],
  },
  {
    key: 'lobster-two', label: '洛斯特体', note: '复古手写标题 · 醒目', family: "'Lobster Two'",
    css: [FS5 + 'lobster-two@5.1.0/400.css'],
  },
  // 新增 11 档：现代宋体、行书、标题体 + 英文手写/装饰体
  {
    key: 'noto-serif-lacuna', label: '思源仿宋', note: '典雅宋体 · 印刷品质感', family: "'Noto Serif SC'",
    css: [FS5 + 'noto-serif-sc@5.1.0/400.css', FS5 + 'noto-serif-sc@5.1.0/700.css'],
  },
  {
    key: 'zcool-jingnv', label: '站酷静女体', note: '秀气手写 · 轻盈', family: "'ZCOOL JingNiTi'",
    css: [FS5 + 'zcool-jing-ni-ti@5.1.0/400.css'],
  },
  {
    key: 'zcool-wenyi', label: '站酷文艺体', note: '清新手写 · 文艺范', family: "'ZCOOL WenYiTi'",
    css: [FS5 + 'zcool-wen-yi-ti@5.1.0/400.css'],
  },
  {
    key: 'zcool-gaoduanhei', label: '站酷高端黑', note: '粗犷标题 · 力量感', family: "'ZCOOL GaoDuanHei'",
    css: [FS5 + 'zcool-gao-duan-hei@5.1.0/400.css'],
  },
  {
    key: 'zcool-wenyihei', label: '站酷文艺黑', note: '圆润黑体 · 亲切', family: "'ZCOOL WenYiHei'",
    css: [FS5 + 'zcool-wen-yi-hei@5.1.0/400.css'],
  },
  {
    key: 'chen-changqing', label: '陈畅情体', note: '手写行楷 · 飘逸', family: "'Chen Chang Qing Ti'",
    css: [FS5 + 'chen-chang-qing-ti@5.1.0/400.css'],
  },
  {
    key: 'caomengyingti', label: '草萌萤体', note: '可爱手写 · 俏皮', family: "'Caomeng Yingti'",
    css: [FS5 + 'caomeng-ying-ti@1.0.0/font.css'],
  },
  {
    key: 'amatic', label: 'Amatic SC', note: '细瘦手写英文 · 标题', family: "'Amatic SC'",
    css: [FS5 + 'amatic-sc@5.3.0/400.css', FS5 + 'amatic-sc@5.3.0/700.css'],
  },
  {
    key: 'caveat', label: 'Caveat', note: '美式手写英文 · 自然', family: "'Caveat'",
    css: [FS5 + 'caveat@5.3.0/400.css', FS5 + 'caveat@5.3.0/700.css'],
  },
  {
    key: 'pacifico', label: 'Pacifico', note: '流畅英文手写 · 经典', family: "'Pacifico'",
    css: [FS5 + 'pacifico@4.0.0/400.css'],
  },
  // 续增 10 档：圆体 / 英文无衬线 / 等宽 / 英文草书 / 中文圆润
  {
    key: 'zcool-round', label: '站酷快乐黑', note: '圆润可爱 · 亲切标题', family: "'ZCOOL KuaiLe Hei'",
    css: [FS5 + 'zcool-kuaile-hei@1.0.0/400.css'],
  },
  {
    key: 'noto-sans-rounded', label: '思源圆体', note: '柔和圆体 · 友好', family: "'Noto Sans SC Rounded'",
    css: [FS5 + 'noto-sans-sc-rounded@1.0.0/400.css', FS5 + 'noto-sans-sc-rounded@1.0.0/700.css'],
  },
  {
    key: 'fira-code', label: 'Fira Code', note: '等宽编程 · 连字友好', family: "'Fira Code'",
    css: [FS5 + 'fira-code@7.3.0/400.css', FS5 + 'fira-code@7.3.0/500.css', FS5 + 'fira-code@7.3.0/700.css'],
  },
  {
    key: 'doto-mono', label: 'Doto Mono', note: '几何等宽 · 科技感', family: "'Doto Mono'",
    css: [FS5 + 'doto-mono@1.0.0/400.css', FS5 + 'doto-mono@1.0.0/700.css'],
  },
  {
    key: 'roboto-slab', label: 'Roboto Slab', note: '稳重衬线英文 · 标题', family: "'Roboto Slab'",
    css: [FS5 + 'roboto-slab@5.3.0/400.css', FS5 + 'roboto-slab@5.3.0/700.css'],
  },
  {
    key: 'playfair', label: 'Playfair Display', note: '时尚衬线英文 · 优雅', family: "'Playfair Display'",
    css: [FS5 + 'playfair-display@5.3.0/400.css', FS5 + 'playfair-display@5.3.0/700.css'],
  },
  {
    key: 'lobster', label: 'Lobster', note: '美式复古英文 · 醒目', family: "'Lobster'",
    css: [FS5 + 'lobster@4.0.0/400.css'],
  },
  {
    key: 'great-vibes', label: 'Great Vibes', note: '华丽英文花体 · 浪漫', family: "'Great Vibes'",
    css: [FS5 + 'great-vibes@4.0.0/400.css'],
  },
  {
    key: 'ma-shan-zheng-cursive', label: '马善政行楷', note: '毛笔行楷 · 飘逸灵动', family: "'Ma Shan Zheng'",
    css: [FS5 + 'ma-shan-zheng@5.1.0/400.css'],
  },
  {
    key: 'noto-serif-cafeteria', label: '思源宋体·餐巾', note: '典雅宋体 · 文艺杂志风', family: "'Noto Serif JP'",
    css: [FS5 + 'noto-serif-jp@5.1.0/400.css', FS5 + 'noto-serif-jp@5.1.0/700.css'],
  },
  // 续增 12 档：几何无衬线 / 现代衬线 / 英文手写艺术 / 装饰粗体 / 斜体衬线
  {
    key: 'rubik', label: 'Rubik', note: '几何无衬线英文 · 现代清爽', family: "'Rubik'",
    css: [FS5 + 'rubik@5.3.0/400.css', FS5 + 'rubik@5.3.0/500.css', FS5 + 'rubik@5.3.0/700.css'],
  },
  {
    key: 'merriweather', label: 'Merriweather', note: '厚重衬线英文 · 长文舒适', family: "'Merriweather'",
    css: [FS5 + 'merriweather@4.0.0/400.css', FS5 + 'merriweather@4.0.0/700.css'],
  },
  {
    key: 'montserrat', label: 'Montserrat', note: '都市无衬线英文 · 百搭', family: "'Montserrat'",
    css: [FS5 + 'montserrat@5.3.0/400.css', FS5 + 'montserrat@5.3.0/500.css', FS5 + 'montserrat@5.3.0/700.css'],
  },
  {
    key: 'lato', label: 'Lato', note: '稳重无衬线英文 · 专业感', family: "'Lato'",
    css: [FS5 + 'lato@3.0.0/400.css', FS5 + 'lato@3.0.0/700.css'],
  },
  {
    key: 'bebas-neue', label: 'Bebas Neue', note: '超粗体大写英文 · 海报感', family: "'Bebas Neue'",
    css: [FS5 + 'bebas-neue@1.0.0/400.css'],
  },
  {
    key: 'raleway', label: 'Raleway', note: '优雅纤细英文 · 时尚', family: "'Raleway'",
    css: [FS5 + 'raleway@5.3.0/300.css', FS5 + 'raleway@5.3.0/400.css', FS5 + 'raleway@5.3.0/700.css'],
  },
  {
    key: 'oswald', label: 'Oswald', note: '压缩无衬线英文 · 新闻标题', family: "'Oswald'",
    css: [FS5 + 'oswald@5.3.0/400.css', FS5 + 'oswald@5.3.0/700.css'],
  },
  {
    key: 'dancing-script', label: 'Dancing Script', note: '流畅英文草书 · 浪漫', family: "'Dancing Script'",
    css: [FS5 + 'dancing-script@4.0.0/400.css'],
  },
  {
    key: 'indie-flower', label: 'Indie Flower', note: '随性英文手写 · 轻松', family: "'Indie Flower'",
    css: [FS5 + 'indie-flower@1.0.0/400.css'],
  },
  {
    key: 'permanent-marker', label: 'Permanent Marker', note: '马克笔英文 · 涂鸦感', family: "'Permanent Marker'",
    css: [FS5 + 'permanent-marker@1.0.0/400.css'],
  },
  {
    key: 'special-elite', label: 'Special Elite', note: '复古打字机英文 · 怀旧', family: "'Special Elite'",
    css: [FS5 + 'special-elite@1.0.0/400.css'],
  },
  {
    key: 'pt-sans', label: 'PT Sans', note: '俄式无衬线英文 · 端庄', family: "'PT Sans'",
    css: [FS5 + 'pt-sans@8.400/css.css'],
  },
  {
    key: 'pt-serif', label: 'PT Serif', note: '俄式衬线英文 · 经典', family: "'PT Serif'",
    css: [FS5 + 'pt-serif@8.400/css.css'],
  },
  // ── 饱满圆融新增 22 档 ──────────────────────────
  {
    key: 'nunito', label: 'Nunito', note: '几何圆体 · 柔和饱满', family: "'Nunito'",
    css: [FS5 + 'nunito@5.3.0/400.css', FS5 + 'nunito@5.3.0/700.css'],
  },
  {
    key: 'nunito-sans', label: 'Nunito Sans', note: '圆润无衬线 · 现代清爽', family: "'Nunito Sans'",
    css: [FS5 + 'nunito-sans@5.3.0/400.css', FS5 + 'nunito-sans@5.3.0/700.css'],
  },
  {
    key: 'quicksand', label: 'Quicksand', note: '圆润无衬线 · 柔和友好', family: "'Quicksand'",
    css: [FS5 + 'quicksand@5.3.0/400.css', FS5 + 'quicksand@5.3.0/700.css'],
  },
  {
    key: 'varela-round', label: 'Varela Round', note: '极简圆体 · 干净利落', family: "'Varela Round'",
    css: [FS5 + 'varela-round@4.0.0/400.css'],
  },
  {
    key: 'comfortaa', label: 'Comfortaa', note: '几何圆体 · 温暖舒适', family: "'Comfortaa'",
    css: [FS5 + 'comfortaa@5.3.0/400.css', FS5 + 'comfortaa@5.3.0/700.css'],
  },
  {
    key: 'baloo-2', label: 'Baloo 2', note: '圆润粗体 · 标题感强', family: "'Baloo 2'",
    css: [FS5 + 'baloo-2@5.3.0/400.css', FS5 + 'baloo-2@5.3.0/700.css'],
  },
  {
    key: 'fredoka-one', label: 'Fredoka One', note: '圆润粗体 · 活泼醒目', family: "'Fredoka One'",
    css: [FS5 + 'fredoka-one@5.3.0/400.css'],
  },
  {
    key: 'bubblegum-sans', label: 'Bubblegum Sans', note: '圆润软体 · 亲切可爱', family: "'Bubblegum Sans'",
    css: [FS5 + 'bubblegum-sans@4.0.0/400.css'],
  },
  {
    key: 'chewy', label: 'Chewy', note: '厚实圆体 · 饱满有力', family: "'Chewy'",
    css: [FS5 + 'chewy@4.0.0/400.css'],
  },
  {
    key: 'chakra-petch', label: 'Chakra Petch', note: '几何圆角 · 科技感', family: "'Chakra Petch'",
    css: [FS5 + 'chakra-petch@5.3.0/400.css', FS5 + 'chakra-petch@5.3.0/700.css'],
  },
  {
    key: 'hind', label: 'Hind', note: '圆润无衬线 · 现代平衡', family: "'Hind'",
    css: [FS5 + 'hind@5.3.0/400.css', FS5 + 'hind@5.3.0/700.css'],
  },
  {
    key: 'mada', label: 'Mada', note: '几何圆体 · 简洁有力', family: "'Mada'",
    css: [FS5 + 'mada@5.3.0/400.css', FS5 + 'mada@5.3.0/700.css'],
  },
  {
    key: 'tajawal', label: 'Tajawal', note: '几何圆体 · 优雅端庄', family: "'Tajawal'",
    css: [FS5 + 'tajawal@5.3.0/400.css', FS5 + 'tajawal@5.3.0/700.css'],
  },
  {
    key: 'almarai', label: 'Almarai', note: '圆润无衬线 · 温和舒适', family: "'Almarai'",
    css: [FS5 + 'almarai@5.3.0/400.css', FS5 + 'almarai@5.3.0/700.css'],
  },
  {
    key: 'boogaloo', label: 'Boogaloo', note: '圆润手写 · 轻松有趣', family: "'Boogaloo'",
    css: [FS5 + 'boogaloo@5.3.0/400.css'],
  },
  {
    key: 'bungee', label: 'Bungee', note: '圆润粗体 · 厚重有力', family: "'Bungee'",
    css: [FS5 + 'bungee@5.3.0/400.css'],
  },
  {
    key: 'passion-one', label: 'Passion One', note: '圆润粗体 · 醒目有力', family: "'Passion One'",
    css: [FS5 + 'passion-one@5.3.0/400.css', FS5 + 'passion-one@5.3.0/700.css'],
  },
  {
    key: 'cabin-sketch', label: 'Cabin Sketch', note: '圆润草图 · 有个性', family: "'Cabin Sketch'",
    css: [FS5 + 'cabin-sketch@5.3.0/400.css', FS5 + 'cabin-sketch@5.3.0/700.css'],
  },
  {
    key: 'patrick-hand', label: 'Patrick Hand', note: '圆润手写 · 柔和易读', family: "'Patrick Hand'",
    css: [FS5 + 'patrick-hand@5.3.0/400.css'],
  },
  {
    key: 'jua', label: 'Jua', note: '韩文圆体 · 饱满柔和', family: "'Jua'",
    css: [FS5 + 'jua@4.0.0/400.css'],
  },
  {
    key: 'single-day', label: 'Single Day', note: '韩文圆体 · 简洁饱满', family: "'Single Day'",
    css: [FS5 + 'single-day@5.3.1/400.css'],
  },
  {
    key: 'do-hyeon', label: 'Do Hyeon', note: '韩文圆体 · 现代有力', family: "'Do Hyeon'",
    css: [FS5 + 'do-hyeon@4.0.0/400.css'],
  },

  // ── 圆体扩充（2026-11-24）──
  // 中文圆体：cn-fontsource 分片的免费商用圆体，字形圆润、适合屏幕正文与标题
  {
    key: 'cn-round-youshe', label: '优设圆体', note: '中文圆体 · 现代圆润', family: "'Youshe Round'",
    css: [CNFS + 'cn-fontsource-youshe-round-tianti@1.0.1/font.css'],
  },
  {
    key: 'cn-round-alimama', label: '阿里妈妈方圆', note: '中文圆体 · 几何方正', family: "'Alimama FangYuanTi VF'",
    css: [CNFS + 'cn-fontsource-alimama-fangyuan-ti-vf@1.0.1/font.css'],
  },
  {
    key: 'cn-round-hanzi', label: '汉字圆体', note: '中文圆体 · 温润饱满', family: "'Hanzi Round SC'",
    css: [CNFS + 'cn-fontsource-hanzi-round-sc@1.0.1/font.css'],
  },
  {
    key: 'cn-round-zcool', label: '站酷圆体', note: '中文圆体 · 圆润活泼', family: "'ZCOOL KuaiLe'",
    css: [FS5 + 'zcool-kuaile@5.1.0/400.css'],
  },
  // 英文圆体：fontsource 几何/柔和圆体，补足多语言混排场景
  {
    key: 'en-round-quicksand', label: 'Quicksand', note: '英文圆体 · 轻盈几何', family: "'Quicksand'",
    css: [FS5 + 'quicksand@5.2.0/400.css', FS5 + 'quicksand@5.2.0/700.css'],
  },
  {
    key: 'en-round-nunito-sans', label: 'Nunito Sans', note: '英文圆体 · 易读正文', family: "'Nunito Sans'",
    css: [FS5 + 'nunito-sans@5.1.0/400.css', FS5 + 'nunito-sans@5.1.0/700.css'],
  },
  {
    key: 'en-round-muli', label: 'Muli', note: '英文圆体 · 简洁圆润', family: "'Muli'",
    css: [FS5 + 'muli@4.0.0/400.css', FS5 + 'muli@4.0.0/700.css'],
  },
  {
    key: 'en-round-sniglet', label: 'Sniglet', note: '英文圆体 · 圆润可爱', family: "'Sniglet'",
    css: [FS5 + 'sniglet@4.0.0/400.css'],
  },
  {
    key: 'en-round-baloo', label: 'Baloo 2', note: '英文圆体 · 饱满友好', family: "'Baloo 2'",
    css: [FS5 + 'baloo-2@5.1.0/400.css', FS5 + 'baloo-2@5.1.0/700.css'],
  },
  {
    key: 'en-round-hind', label: 'Hind', note: '英文圆体 · 柔和现代', family: "'Hind'",
    css: [FS5 + 'hind@5.1.0/400.css', FS5 + 'hind@5.1.0/700.css'],
  },
]

export function getFont() {
  const v = readRaw(FONT_KEY, DEFAULT_FONT)
  return FONT_OPTS.some((o) => o.key === v) ? v : DEFAULT_FONT
}

/**
 * 当前字体的完整 family 栈（与 applyFont 写入 --app-font 的值逐字一致）。
 * 供 canvas 绘制（复制图片）复用，保证图片字体与界面「账号与设置 → 界面字体」完全一致。
 * @param {string} [key] 指定档位；不传则取当前生效档
 */
export function getFontFamily(key) {
  const opt = FONT_OPTS.find((o) => o.key === (key || getFont())) || FONT_OPTS[0]
  return opt.family ? `${opt.family}, ${BASE_FONT_STACK}` : BASE_FONT_STACK
}

/** 幂等注入一个 <link rel=stylesheet>（同一 URL 只注一次，重复调用零开销） */
function injectCss(url) {
  const ID = 'whbis-font-css'
  const host = document.getElementById(ID) || (() => {
    const h = document.createElement('div')
    h.id = ID
    h.style.display = 'none'
    document.head.appendChild(h)
    return h
  })()
  if (host.querySelector(`link[data-h="${cssKey(url)}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  link.dataset.h = cssKey(url)
  host.appendChild(link)
}

/** URL → 稳定短 id（data 属性不能用任意字符，取个简单 hash） */
function cssKey(url) {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0
  return 'f' + h.toString(36)
}

/** 把字体档位应用到 <html>：注入所需 CSS + 写 --app-font 变量（App.vue 的 page 据此生效） */
export function applyFont(key) {
  // #ifdef H5
  try {
    const opt = FONT_OPTS.find((o) => o.key === (key || getFont())) || FONT_OPTS[0]
    opt.css.forEach(injectCss)
    document.documentElement.style.setProperty('--app-font', getFontFamily(key))
  } catch (e) { /* 忽略 */ }
  // #endif
}

/** 落库 + 应用，返回生效档 key */
export function setFont(key) {
  if (FONT_OPTS.some((o) => o.key === key)) {
    writeRaw(FONT_KEY, key)
    applyFont(key)
  }
  return getFont()
}

/**
 * 预载全部档位 CSS（设置面板打开时调用一次）：让每个选项卡上的字体名
 * 直接用真字体渲染当预览。unicode-range 分片下，预览文案只会拉对应字形
 * 的小分片（每档几十 KB），不会整包下载。
 */
export function ensureFontPreviews() {
  // #ifdef H5
  try {
    FONT_OPTS.forEach((o) => o.css.forEach(injectCss))
  } catch (e) { /* 忽略 */ }
  // #endif
}

// ── 仿真站牌设计 ──
// 启用后，实时线路的「线路走向」改用公交站牌风格呈现（站点横排 + 连线 + 首末站高亮）。
// 纯展示开关，不改动数据链路；默认关闭，本机记忆。
const SIGNBOARD_KEY = 'whbis:sim-signboard'

export function getSimSignboard() {
  const v = readRaw(SIGNBOARD_KEY, false)
  return v === true || v === 'true' || v === 1 || v === '1'
}

export function setSimSignboard(on) {
  writeRaw(SIGNBOARD_KEY, !!on)
  return getSimSignboard()
}

// ── 线路站牌极简模式 ──
// 启用后，LineStops 改用「站牌」风格渲染：只保留线路头 + 候车信息 + 站点序列，
// 隐藏刷新控件 / 方向分段 / 运营指标等冗余元素。只有开 / 关两档，默认关闭，本机记忆。
// 排列方向固定为竖向（每站一行），不再提供横向滚带；上下行切换与退出入口在面板内。
const MIN_MODE_KEY = 'whbis:min-stops-mode'

export function getMinStopsMode() {
  const v = readRaw(MIN_MODE_KEY, false)
  return v === true || v === 'true' || v === 1 || v === '1'
}

export function setMinStopsMode(on) {
  writeRaw(MIN_MODE_KEY, !!on)
  return getMinStopsMode()
}

// ── 高德地图 Key（用户自填，BYOK） ──
// H5 端：填入后 LineMap 切换为原生 <map> 渲染，走向 / 车辆 / 站点均走高德 JS API，
// 比自绘走向图更贴近真实公交轨迹。留空时保持自绘模式（免 Key 的 OSRM 贴路）。
// 申请地址：https://console.amap.com/dev/#/key （Web端 JS API 类型，个人开发者有免费配额）
const AMAP_KEY_KEY = 'whbis:amap-key'

export function getAmapKey() {
  return String(readRaw(AMAP_KEY_KEY, '') || '').trim()
}

export function setAmapKey(key) {
  const v = String(key == null ? '' : key).trim()
  writeRaw(AMAP_KEY_KEY, v)
  return v
}

/** 读取 KEY：返回 { key, secret }。兼容旧版「一个输入框、英文逗号拼接」的存储格式。 */
export function getAmapKeyPair() {
  const v = getAmapKey()
  const parts = String(v).split(/[,，]/)
  return {
    key: (parts[0] || '').trim(),
    secret: (parts.slice(1).join(',') || '').trim(),
  }
}

/** 分别保存 KEY 与安全密钥：存储仍用 `key,secret` 拼接，loadAmapJsApi 已有拆分逻辑，无需改动 */
export function setAmapKeyPair(key, secret) {
  const k = String(key == null ? '' : key).trim()
  const s = String(secret == null ? '' : secret).trim()
  return setAmapKey(s ? `${k},${s}` : k)
}

// 高德官方轨迹的日调用计数（本机、按自然日）：每次 LineSearch 查询 +1，跨天自动归零。
// 只作本机用量参考（不上传、不代表高德账号实际账单），帮用户估算当日配额消耗。
const AMAP_USAGE_KEY = 'whbis:amap-usage'

function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 读取本机今日已查询次数
export function getAmapUsageToday() {
  let v = null
  try {
    v = uni.getStorageSync(AMAP_USAGE_KEY)
    if (typeof v === 'string') v = JSON.parse(v)
  } catch (e) { v = null }
  if (!v || typeof v !== 'object' || v.date !== todayStr()) return 0
  const n = Number(v.count)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// 记一次高德官方轨迹查询，返回自增后的今日次数
export function bumpAmapUsage() {
  const n = getAmapUsageToday() + 1
  writeRaw(AMAP_USAGE_KEY, { date: todayStr(), count: n })
  return n
}

// 免 Key 方案的高德网页会话 Cookie：用户自己的账号 Cookie，不再全员共用一份。
// 本机存一份供前端参考；Actions 侧从仓库 scripts/amap-cookie.json 读取（见 workflow）。
const AMAP_WEB_COOKIE_KEY = 'whbis:amap-web-cookie'

/** 读取本机保存的免 Key Cookie（trim 后返回） */
export function getAmapWebCookie() {
  return String(readRaw(AMAP_WEB_COOKIE_KEY, '') || '').trim()
}

/** 保存免 Key Cookie；传空串即清空 */
export function setAmapWebCookie(cookie) {
  const v = String(cookie == null ? '' : cookie).trim()
  writeRaw(AMAP_WEB_COOKIE_KEY, v)
  return v
}

/**
 * 生成可提交到仓库的 scripts/amap-cookie.json 内容。
 * Actions checkout 仓库后读该文件注入 AMAP_WEB_COOKIE，实现「每人用自己的 Cookie」。
 * 返回 JSON 字符串（带缩进，便于人工核对 / 粘贴）。
 */
export function buildAmapCookieConfig(cookie) {
  return JSON.stringify({
    cookie: String(cookie == null ? '' : cookie).trim(),
    note: '免 Key 方案的高德网页会话 Cookie。Actions 读取此文件的 cookie 字段注入 AMAP_WEB_COOKIE；留空则回退到仓库 Secrets。请勿提交他人 Cookie。',
  }, null, 2)
}
