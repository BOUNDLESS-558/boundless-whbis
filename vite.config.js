import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uni(),
  ],
  // H5 本地开发跨域代理：将 /api 代理到武汉公交接口服务
  server: {
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
