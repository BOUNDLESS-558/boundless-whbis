/**
 * 诊断：uni-h5 下 #app 的 Vue 实例结构，找出如何访问 line.vue 的 showSettings。
 * 临时排查用，跑完自删。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9359
const PROFILE = path.join(process.env.TMP || '.', 'edge-vue-prof')
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
  } catch (e) {}
  await sleep(250)
}
if (!wsUrl) { console.error('CDP 未就绪'); child.kill(); process.exit(1) }

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((r) => pending.set(mid, r)); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } }
const evalV = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); if (r && r.result && r.result.subtype === 'error') console.log('EVAL ERR:', r.result.description); return r && r.result ? r.result.value : null; }

ws.onopen = async () => {
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.navigate', { url: URL_HOME })
  await sleep(8000)

  // 诊断：#app 的 Vue 实例结构
  const diag = await evalV(`(() => {
    const app = document.getElementById('app');
    if (!app) return { err: 'no-app' };
    const keys = Object.keys(app);
    const info = { keys: keys };
    for (const k of keys) {
      if (k.startsWith('__vue')) {
        const v = app[k];
        if (v && typeof v === 'object') {
          info[k] = {
            type: v.type ? v.type.name : (v.type ? typeof v.type : 'no-type'),
            hasProxy: !!v.proxy,
            proxyKeys: v.proxy ? Object.keys(v.proxy).slice(0, 20) : null,
            hasSetupState: !!v.setupState,
            setupKeys: v.setupState ? Object.keys(v.setupState).slice(0, 20) : null,
            hasChildren: !!(v.children && v.children.length),
            childrenCount: v.children ? v.children.length : 0,
            childrenTypes: v.children ? v.children.map(c => c.type ? c.type.name : (c.type ? typeof c.type : '?')).slice(0, 10) : null,
            hasSubTree: !!v.subTree,
            subTreeTag: v.subTree && v.subTree.tag,
            subTreeChildren: v.subTree && v.subTree.children ? v.subTree.children.map(c => c.tag || (c.type ? c.type.name : '?')).slice(0, 10) : null,
          };
        }
      }
    }
    return info;
  })()`)
  console.log('Vue 实例结构:', JSON.stringify(diag, null, 2))

  // 尝试直接找 line.vue 的 showSettings
  const tryClose = await evalV(`(() => {
    const app = document.getElementById('app');
    if (!app) return 'no-app';
    const root = app.__vueParentComponent || app.__vueInstance;
    if (!root) return 'no-root';
    
    // 尝试多种路径
    const results = {};
    
    // 路径1: root.proxy
    if (root.proxy) {
      results.rootProxyKeys = Object.keys(root.proxy).filter(k => k !== '$' && !k.startsWith('$')).slice(0, 20);
      if (root.proxy.showSettings !== undefined) {
        root.proxy.showSettings = false;
        results.path1 = 'closed-via-root-proxy';
      }
    }
    
    // 路径2: 递归遍历
    function walk(comp, depth) {
      if (!comp || depth > 10) return null;
      if (comp.type && comp.type.name === 'line' && comp.proxy && comp.proxy.showSettings !== undefined) {
        return comp;
      }
      const sources = [];
      if (comp.subTree && comp.subTree.children) sources.push(...comp.subTree.children);
      if (comp.children) sources.push(...comp.children);
      for (const ch of sources) {
        const r = walk(ch, depth + 1);
        if (r) return r;
      }
      return null;
    }
    const line = walk(root, 0);
    if (line) {
      results.foundLine = true;
      line.proxy.showSettings = false;
      results.path2 = 'closed-via-walk';
    } else {
      results.foundLine = false;
    }
    
    return results;
  })()`)
  console.log('尝试关抽屉:', JSON.stringify(tryClose))
  await sleep(500)
  const closed = await evalV('!!document.querySelector(".sd-mask")')
  console.log('抽屉已关?', closed)

  ws.close(); child.kill(); process.exit(0)
}