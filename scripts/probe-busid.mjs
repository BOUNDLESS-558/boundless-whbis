/**
 * 逆向还原实时车辆编号：扩大枚举范围找出明文规律
 * 用法：node scripts/probe-busid.mjs
 */
import { md5 } from '../src/utils/md5.js'

const HASHES = new Set([
  '94edfc18161ac941c9f613d290a159f6','7b8fac333fe4ec9b044a8a64829a9e4b','cd1cf1b9f66e3fc9ca447124810dcd20',
  'bed5623adc8b12bc67a4221a5d5cccc4','8b739d9e6db9de1ca6df2c438d0986f8','b7046757c3682a28c5bf2024e57678a0',
  '57f2b3cf26b3d12b9ecd389b401a1300','cc638784cf213986ec75983a4aa08cdb','fac99c77695b5655eefadf78498b8430',
  '8e9cd191d3eaf58c4d262677292270e5','71964ed9f684f669180eed60be305c42','9c9b9968f53b847802ec73df94b649c0',
  'a896b6cbbe199b67c0f76f6f0e4b55d5','220bd44f67edd4f311c6c06436cf9a65','165fdc9623e63b94742e6dd07b81e45b',
  '1e50b8b75ce32422bed8115d5da4fbaf','b7cf1dbb51db462f3ad750d65d42a3a6','9e3c9c0a7cb805136946d081eee6d0ac',
  '5dcef39f7ee1e03911b48b876ecf448e','ec88121df4e8a5ea1665067e0305bcf2','ce74b141bbb6d057b757fffd582cad93',
  'ad7bdcafbea74680e11d25162a145507','42d0c639a21482dcd8e1c447efe87e89','b5d62aa6024ab6a65a12c78c4c2d4efc',
  '10b4945abe2e627db646b3c5226a4e50','9ceae8c670b29723b028f6cf289891ba','c370ec3d80532ba4afe5af93000db96e',
  '626a16723d6c7e9dd81275a38cf68326','9f5da34aad85d5221bf88d8e16fcd591','1e632c3db5602c1e2639897989497ca5',
  '539f0ff3170030c9ae2c23096a4b9b10','3fde502aa65e2ce159a2a255ac96f632','70292e6b43b44843327d4d51a3d89f94',
  '44c2630eab1d5a8bea8cef42cac127cd','67f098b0f09ef0f126d271764cf270fc','a9a6bc8f86138d7b4c7a186ceb947b62',
])

const found = new Map()
const MAX = 400000
const t0 = Date.now()
for (let n = 0; n <= MAX; n++) {
  const h = md5(String(n))
  if (HASHES.has(h)) found.set(h, String(n))
}
console.log(`纯数字枚举 0..${MAX}: 命中 ${found.size}/${HASHES.size}  (耗时 ${Date.now() - t0}ms)`)
for (const [h, p] of found) console.log(`  ${h}  ->  ${p}`)

const missing = [...HASHES].filter((h) => !found.has(h))
if (missing.length) {
  console.log(`\n未命中 ${missing.length} 个，尝试带前缀/后缀的组合...`)
  const prefixes = ['', '420100', '420100-', 'W', 'BUS', 'bus', 'wh', 'WH', 'wuhan', 'hb']
  const suffixes = ['', '-0', '-1', 'bus', ' BUS']
  outer: for (const pre of prefixes) {
    for (const suf of suffixes) {
      for (let n = 0; n <= 60000; n++) {
        const h = md5(`${pre}${n}${suf}`)
        if (HASHES.has(h)) {
          console.log(`  组合命中: pre="${pre}" n=${n} suf="${suf}"  ->  ${h}`)
          found.set(h, `${pre}${n}${suf}`)
          if (found.size === HASHES.size) break outer
        }
      }
    }
  }
  console.log(`\n最终命中 ${found.size}/${HASHES.size}`)
  if (found.size < HASHES.size) {
    console.log('仍未命中：')
    for (const h of [...HASHES].filter((x) => !found.has(x))) console.log('  ' + h)
  }
}
