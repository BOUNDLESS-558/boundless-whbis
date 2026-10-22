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
  },
})
