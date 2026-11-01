/**
 * 探针共享：为受登录守卫保护的页面预置会话。
 *
 * 背景：pages.json 首页指向 login，地图页 onLoad 有 requireLogin() 守卫，
 * 全新 profile 没有会话会被弹回登录页 → 探针取不到控制卡。这里在真正进目标页前，
 * 先在同源（登录页）用 uni 自己的 setStorageSync 写入会话（值序列化交给 uni，
 * 避免手工拼 {"type":..,"data":..} 包装），随后导航即通过守卫。
 *
 * 会话格式跟 src/utils/auth.js 对齐：{ account, loginAt, expiresAt }，且 account
 * 必须是 EMBEDDED_ACCOUNTS 里的预置账号（normAccount 后在表内才判已登录）。
 * 这里直接 import auth.js 取真实名单，改账号表不会再把探针静默弄坏。
 *
 * 用法（各探针 ws.onopen 里 Page.enable/Runtime.enable 之后、首次导航到目标页之前）：
 *   import { seedLogin } from './probe-auth.mjs'
 *   ...
 *   await seedLogin({ send, BASE, sleep })
 *
 * 自包含：不依赖调用方的 evalV（部分探针没有它），自己走 Runtime.evaluate。
 */
import { EMBEDDED_ACCOUNTS } from '../src/utils/auth.js'

const SESSION_KEY = 'whbis:session'
// 取预置表首个账号（normAccount 后仍在表内即可过守卫）
const SEED_ACCOUNT = EMBEDDED_ACCOUNTS[0]

export async function seedLogin({ send, BASE, sleep }) {
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return r && r.result ? r.result.value : null
  }
  // 先到入口（登录页，同源）拿到 window.uni
  await send('Page.navigate', { url: `${BASE}#/?seed=${Date.now()}` })
  for (let i = 0; i < 60; i++) {
    if (await evaluate('!!window.uni')) break
    await sleep(200)
  }
  await evaluate(`(() => {
    const now = Date.now();
    try {
      uni.setStorageSync(${JSON.stringify(SESSION_KEY)}, { account: ${JSON.stringify(SEED_ACCOUNT)}, loginAt: now, expiresAt: now + 30 * 86400000 });
    } catch (e) { /* 存储不可用则守卫仍会拦截，由调用方自行暴露失败 */ }
    return 1;
  })()`)
}
