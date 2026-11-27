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
const REPO = 'BOUNDLESS-558/boundless-whbis'
const WORKFLOW = 'vehicle-ops.yml'
const DISPATCH_API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`
const RUNS_API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=5`

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
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'whbis-cron-worker',
  }
  try {
    // 防堆积：触发前查最近 5 轮，只要有 queued/in_progress 就跳过本轮。
    // 单轮采集约 70~80s > cron 间隔 60s，若不跳过会越排越多、最终被 GitHub 取消。
    const listRes = await fetch(RUNS_API, { headers, cf: { cacheTtl: 0 } })
    if (!listRes.ok) {
      const text = await listRes.text()
      return { ok: false, error: `查询运行列表失败 ${listRes.status}: ${text.slice(0, 160)}` }
    }
    const list = await listRes.json()
    const busy = (list.workflow_runs || []).some((r) => r.status === 'queued' || r.status === 'in_progress' || r.status === 'pending')
    if (busy) {
      console.log(`[${new Date().toISOString()}] 上一轮仍在运行/排队，跳过本次触发（防堆积）`)
      return { ok: true, skipped: true }
    }

    const res = await fetch(DISPATCH_API, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
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
