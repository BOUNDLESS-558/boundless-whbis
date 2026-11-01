import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uni(),
  ],
  // H5 本地开发跨域代理：将 /api 代理到武汉公交接口服务
  server: {
    // 绑定所有网卡（IPv4 + IPv6）：避免只绑 ::1 时，localhost 被解析到 127.0.0.1
    // 或局域网/手机访问时连不上（表现为 ERR_CONNECTION_TIMED_OUT）
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://customized.wuhanbus.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, '/gps-resapi/wechat/bus'),
      },
    },
    // 探针脚本会把日志与截图写到 .openchamber，打包产物写到 dist；
    // 不排除的话 vite 会去 watch 这些文件，探针正在写入时抛 EBUSY 并直接杀掉 dev server。
    watch: {
      ignored: ['**/.openchamber/**', '**/dist/**', '**/.idea/**'],
    },
  },
})
