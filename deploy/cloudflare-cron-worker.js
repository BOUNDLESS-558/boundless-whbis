/**
 * Cloudflare Worker：准时 cron 触发器（免费额度）
 *
 * 作用：每分钟准时调用 GitHub Actions API 触发 vehicle-ops.yml 的 workflow_dispatch，
 *       绕开 GitHub Actions schedule 的高峰期延迟 / 丢任务问题。
 *
 * 为什么这样设计：
 *   - GitHub Actions 的 schedule cron 最小 1 分钟且高峰可延迟 3~12 小时；
 *   - 但通过 API 触发的 workflow_dispatch 是即时的（不走 schedule 队列）；
 *   - Cloudflare Workers 免费版提供 5 个 Cron Trigger / 账号，1 个足够；
 *   - Worker 每分钟只发 1 个 fetch，CPU 10ms 完全够用。
 *
 * 部署：见 deploy/CLOUDFLARE-CRON.md
 */
const GITHUB_API = 'https://api.github.com/repos/BOUNDLESS-558/boundless-whbis/actions/workflows/vehicle-ops.yml/dispatches'

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(trigger(env).then((r) => { if (!r.ok) console.error('cron 触发失败：' + r.error) }))
  },
  // 手动测试：curl https://<worker域名>/trigger
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/trigger') {
      const r = await trigger(env)
      return new Response(r.ok ? 'triggered' : ('failed: ' + r.error), { status: r.ok ? 200 : 500 })
    }
    return new Response('ok', { status: 200 })
  },
}

async function trigger(env) {
  const token = env.GITHUB_TOKEN
  if (!token) return { ok: false, error: '缺少 GITHUB_TOKEN（需 repo 权限 PAT）' }
  try {
    const res = await fetch(GITHUB_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'whbis-cron-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error(`GitHub API 返回 ${res.status}: ${text}`)
      return { ok: false, error: `GitHub ${res.status}: ${text.slice(0, 200)}` }
    }
    console.log(`[${new Date().toISOString()}] 已触发 vehicle-ops workflow`)
    return { ok: true }
  } catch (e) {
    const msg = String(e && e.message || e)
    console.error('触发失败：' + msg)
    return { ok: false, error: msg }
  }
}
