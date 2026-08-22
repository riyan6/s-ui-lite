import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './'：构建产物使用相对路径，便于 Go 二进制内嵌后任意路径部署
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: {
      // 开发模式下 API 代理到本地 Go 后端
      '/api': 'http://127.0.0.1:2095',
    },
  },
  build: {
    outDir: 'dist',
  },
})
