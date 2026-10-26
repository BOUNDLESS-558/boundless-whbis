/**
 * 设置抽屉关闭按钮诊断：sd-close 是什么元素、click 事件是否到达 Vue 监听、
 * 以及直接操作 Vue 实例能否关掉抽屉。临时排查用，跑完自删。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9358
const PROFILE = path.join(process.env.TMP || '.', 'edge-drawer-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const URL_HOME = `${BASE}#/pages/line/line`

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' })

let wsUrl = null
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page) { wsUrl = page.webSocketDebuggerUrl; break }
  } catch (e) { /* retry */ }
  await sleep(250)
}
if (!wsUrl) { console.error('CDP 未就绪'); child.kill(); process.exit(1) }

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((r) => pending.set(mid, r))
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const evalV = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (r && r.result && r.result.subtype === 'error') console.log('EVAL ERR:', r.result.description)
  return r && r.result ? r.result.value : null
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')

  await send('Page.navigate', { url: URL_HOME })
  await sleep(6000)

  // 点齿轮开抽屉
  await evalV('document.querySelector(".ab-gear").click()')
  await sleep(600)

  // 诊断 1：sd-close 是什么元素
  const diag1 = await evalV(`(() => {
    const c = document.querySelector(".sd-close");
    if (!c) return { err: "no-close" };
    return {
      tag: c.tagName,
      cls: c.className,
      text: c.innerText,
      html: c.outerHTML.substring(0, 400),
      rect: c.getBoundingClientRect()
    };
  })()`)
  console.log('① sd-close 元素:', JSON.stringify(diag1))

  // 诊断 2：dispatchEvent 点击后抽屉是否关
  await evalV(`(() => {
    const c = document.querySelector(".sd-close");
    if (!c) return "no-close";
    c.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return "clicked";
  })()`)
  await sleep(500)
  const stillOpen1 = await evalV('!!document.querySelector(".sd-mask")')
  console.log('② dispatchEvent 后抽屉仍开着?', stillOpen1)

  // 诊断 3：原生 .click() 方法
  await evalV(`(() => {
    const c = document.querySelector(".sd-close");
    if (!c) return "no-close";
    c.click();
    return "clicked";
  })()`)
  await sleep(500)
  const stillOpen2 = await evalV('!!document.querySelector(".sd-mask")')
  console.log('③ .click() 后抽屉仍开着?', stillOpen2)

  // 诊断 4：直接操作 Vue 实例关
  const vueClose = await evalV(`(() => {
    const app = document.getElementById("app") || document.querySelector("#app");
    if (!app) return "no-app";
    const root = app.__vueParentComponent || app.__vueInstance;
    if (!root) return "no-root-vue";
    // 递归找 SettingsDrawer 组件实例
    function findComp(comp, name) {
      if (!comp) return null;
      if (comp.type && comp.type.name === name) return comp;
      const children = comp.subTree && comp.subTree.children;
      if (children) {
        for (const ch of children) {
          const r = findComp(ch, name);
          if (r) return r;
        }
      }
      if (comp.children) {
        for (const ch of comp.children) {
          const r = findComp(ch, name);
          if (r) return r;
        }
      }
      return null;
    }
    const sd = findComp(root, "SettingsDrawer");
    if (!sd) return "no-SettingsDrawer-found";
    // 找父组件（line.vue），设 settingsOpen = false
    const parent = sd.parent;
    if (!parent) return "no-parent";
    // 尝试直接改 setupState
    if (parent.setupState) {
      parent.setupState.settingsOpen = false;
      return "closed-via-setupState";
    }
    // 尝试 proxy
    if (parent.proxy) {
      parent.proxy.settingsOpen = false;
      return "closed-via-proxy";
    }
    return "no-state-access";
  })()`)
  console.log('④ Vue 实例直接关:', vueClose)
  await sleep(500)
  const closedAfterVue = await evalV('!!document.querySelector(".sd-mask")')
  console.log('⑤ Vue 关完后 mask 还在?', closedAfterVue)

  // 诊断 6：遮罩本身的 click
  await evalV(`(() => {
    const g = document.querySelector(".ab-gear");
    if (g) g.click();
    return "reopened";
  })()`)
  await sleep(600)
  await evalV(`(() => {
    const m = document.querySelector(".sd-mask");
    if (!m) return "no-mask";
    m.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return "mask-clicked";
  })()`)
  await sleep(500)
  const maskStillThere = await evalV('!!document.querySelector(".sd-mask")')
  console.log('⑥ 遮罩 click 后仍在?', maskStillThere)

  ws.close(); child.kill(); process.exit(0)
}