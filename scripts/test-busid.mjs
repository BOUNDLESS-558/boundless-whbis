/**
 * 验证分片字典构建逻辑（终止性 + 正确性 + 性能）
 * 运行：node scripts/test-busid.mjs
 */
import { decryptBusId, onBusIdReady, isBusIdReady, warmUp } from '../src/utils/busId.js'

const CASES = [
  ['3228', '040a99f23e8960763e680041c601acab'],
  ['3240', 'd15426b9c324676610fbb01360473ed8'],
  ['32426', 'fac99c77695b5655eefadf78498b8430'],
  ['5263', 'cc638784cf213986ec75983a4aa08cdb'],
  ['5302', 'b7046757c3682a28c5bf2024e57678a0'],
  ['7908', '42d0c639a21482dcd8e1c447efe87e89'],
  ['12447', '165fdc9623e63b94742e6dd07b81e45b'],
  ['22527', '44c2630eab1d5a8bea8cef42cac127cd'],
  ['52826', 'c370ec3d80532ba4afe5af93000db96e'],
  ['53144', '57f2b3cf26b3d12b9ecd389b401a1300'],
  ['72502', '94edfc18161ac941c9f613d290a159f6'],
  ['72541', 'bed5623adc8b12bc67a4221a5d5cccc4'],
]

let failed = 0
const t0 = Date.now()

console.log('触发字典构建...')
warmUp()

// 记录构建完成耗时
onBusIdReady(() => {
  const ms = Date.now() - t0
  console.log(`字典构建完成，耗时 ${ms}ms\n`)

  for (const [plain, hash] of CASES) {
    const got = decryptBusId(hash)
    const ok = got === plain
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  decryptBusId(${hash.slice(0, 12)}...) = ${got}${ok ? '' : `  (expected ${plain})`}`)
  }

  // 终止性检查：构建完成后不应再有定时任务堆积
  console.log(`\nisBusIdReady() = ${isBusIdReady()}`)
  console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} TEST(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
})

// 超时保护：若 30 秒仍未完成则判定为死循环
setTimeout(() => {
  console.error('超时 30s：字典构建未完成（可能存在死循环）')
  process.exit(1)
}, 30000)
