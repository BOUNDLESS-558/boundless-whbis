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
    ctx.waitUntil(trigger(env))
  },
  // 手动测试：curl https://<worker域名>/trigger
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/trigger') {
      const ok = await trigger(env)
      return new Response(ok ? 'triggered' : 'failed', { status: ok ? 200 : 500 })
    }
    return new Response('ok', { status: 200 })
  },
}

async function trigger(env) {
  const token = env.GITHUB_TOKEN
  if (!token) {
    console.error('缺少 GITHUB_TOKEN（需要 repo 权限的 PAT）')
    return false
  }
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
      console.error(`GitHub API 返回 ${res.status}: ${await res.text()}`)
      return false
    }
    console.log(`[${new Date().toISOString()}] 已触发 vehicle-ops workflow`)
    return true
  } catch (e) {
    console.error('触发失败：' + (e && e.message || e))
    return false
  }
}
