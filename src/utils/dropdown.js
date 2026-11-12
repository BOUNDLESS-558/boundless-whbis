/**
 * 全站下拉仲裁器（只管 UI 展开态，不持久化、不发请求）
 *
 * 规则：同一时刻只允许一个「就地弹出菜单」展开——刷新间隔、复制方式、搜索联想等。
 * 新菜单 claim 时广播新 id，其余订阅者发现「不是自己」就把自己的展开态置 false，
 * 因此不会出现两个下拉同时挂着、后开的遮罩压住先开的选项这种互相打架的情况。
 *
 * 顺带统一「点空白处关闭」：H5 下由仲裁器挂一个 document 级 pointerdown（捕获阶段），
 * 点击落在当前展开菜单的组件根节点之外就全部收起。过去只有部分菜单自带透明遮罩，
 * 搜索联想面板更是完全没有外部关闭，现在一处接管。
 *
 * 模态 / 可拖动浮窗（线路库详情、激活码弹窗、账号与设置窗）不注册，
 * 它们打开时调 closeAllDropdowns() 清场即可。
 */
let seq = 0
const entries = new Set()
let activeId = ''
let listening = false

function notify() {
  entries.forEach((s) => {
    try { s.onChange(activeId) } catch (e) { /* 单个订阅者异常不影响其它控件 */ }
  })
}

// uni-app 里 $el 可能是组件实例，统一取到真实 DOM
function toDom(v) {
  if (!v) return null
  const n = v.$el || v
  return n && typeof n.contains === 'function' ? n : null
}

function onDocPointerDown(e) {
  if (!activeId) return
  let inside = false
  entries.forEach((s) => {
    if (s.id !== activeId || inside) return
    const root = toDom(s.getRoot && s.getRoot())
    if (root && root.contains(e.target)) inside = true
  })
  if (!inside) releaseDropdown(activeId)
}

function listen() {
  if (listening || typeof document === 'undefined') return
  document.addEventListener('pointerdown', onDocPointerDown, true)
  listening = true
}

function unlisten() {
  if (!listening || typeof document === 'undefined') return
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  listening = false
}

export function claimDropdown(id) {
  activeId = id
  notify()
  listen()
}

export function releaseDropdown(id) {
  // 被别的菜单挤掉后，旧菜单再调 release 不能把新的那个关掉
  if (activeId !== id) return
  activeId = ''
  notify()
  unlisten()
}

export function closeAllDropdowns() {
  if (activeId) {
    activeId = ''
    notify()
  }
  unlisten()
}

/**
 * 注册一个下拉，返回句柄 { id, claim(), release(), dispose() }。
 * 组件：展开后 claim、收起后 release、卸载时 dispose。
 * onChange(activeId) 在任一菜单展开 / 收起时广播；空串表示当前没有菜单展开。
 * getRoot 返回包含「触发按钮 + 菜单」的 DOM，用于判断点外部。
 */
export function registerDropdown(prefix, onChange, getRoot) {
  const id = `${prefix}-${++seq}`
  const s = {
    id,
    onChange: typeof onChange === 'function' ? onChange : () => {},
    getRoot,
  }
  entries.add(s)
  // 注册时已有别的菜单展开：立刻同步为「保持关闭」
  if (activeId && activeId !== id) s.onChange(activeId)
  return {
    id,
    claim: () => claimDropdown(id),
    release: () => releaseDropdown(id),
    dispose: () => {
      entries.delete(s)
      releaseDropdown(id)
    },
  }
}

/**
 * Options API 便捷接线：把 vm 上的某个布尔展开态接进仲裁器。
 * 组件 mounted 里调一次，卸载时调 `vm._dd.dispose()`；
 * 模板 / 方法里用 `vm._dd.open() / close() / toggle()` 即可。
 */
export function attachDropdown(vm, stateKey, prefix) {
  let selfId = ''
  const dd = registerDropdown(prefix, (id) => {
    if (vm[stateKey] && id !== selfId) vm[stateKey] = false
  }, () => vm.$el)
  selfId = dd.id
  const api = {
    id: dd.id,
    open() {
      vm[stateKey] = true
      dd.claim()
    },
    close() {
      vm[stateKey] = false
      dd.release()
    },
    toggle() {
      if (vm[stateKey]) api.close()
      else api.open()
    },
    dispose() {
      dd.dispose()
      if (vm._dd === api) vm._dd = null
    },
  }
  vm._dd = api
  return api
}
