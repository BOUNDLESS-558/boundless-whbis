/**
 * MD5 实现单元测试
 * 运行： node scripts/test-md5.mjs
 * 验证手写 MD5 与已知标准值一致（RFC 1321 测试向量 + 接口实测数据）
 */
import { md5, md5Reverse } from '../src/utils/md5.js'

const cases = [
  // RFC 1321 官方测试向量
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
  ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  // 接口实测数据（busId = MD5(orgBusId)）
  ['32379', '2f9fb60d8cd21c36765ffb4c04a86f35'],
  ['3240', 'd15426b9c324676610fbb01360473ed8'],
  ['32426', 'fac99c77695b5655eefadf78498b8430'],
  ['3228', '040a99f23e8960763e680041c601acab'],
  ['32195', '6623f60e12e3d40244a0a59f4f765695'],
  ['32415', '5003307d211c815c97cc8bada9c6edec'],
  ['3306', '16fc18d787294ad5171100e33d05d4e2'],
]

let failed = 0
for (const [plain, expected] of cases) {
  const got = md5(plain)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  md5(${JSON.stringify(plain)}) = ${got}${ok ? '' : `  (expected ${expected})`}`)
}

// 逆向还原测试
console.log('\n--- md5Reverse ---')
for (const [plain, hash] of cases.slice(7)) {
  const rev = md5Reverse(hash, 200000)
  const ok = rev === plain
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  md5Reverse(${hash.slice(0, 12)}...) = ${rev}${ok ? '' : `  (expected ${plain})`}`)
}

// 实测线上车辆编号（覆盖 5千~8万 区间，验证枚举范围足够）
console.log('\n--- 线上车辆编号还原 ---')
const liveCases = [
  ['5263', 'cc638784cf213986ec75983a4aa08cdb'],
  ['5302', 'b7046757c3682a28c5bf2024e57678a0'],
  ['7908', '42d0c639a21482dcd8e1c447efe87e89'],
  ['12447', '165fdc9623e63b94742e6dd07b81e45b'],
  ['22527', '44c2630eab1d5a8bea8cef42cac127cd'],
  ['52826', 'c370ec3d80532ba4afe5af93000db96e'],
  ['53144', '57f2b3cf26b3d12b9ecd389b401a1300'],
  ['72541', 'bed5623adc8b12bc67a4221a5d5cccc4'],
]
for (const [plain, hash] of liveCases) {
  const rev = md5Reverse(hash, 200000)
  const ok = rev === plain
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  md5Reverse(${hash.slice(0, 12)}...) = ${rev}${ok ? '' : `  (expected ${plain})`}`)
}

console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} TEST(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
