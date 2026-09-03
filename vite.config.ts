import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' 让 dist 能直接丢到 GitHub Pages 或任何静态目录下跑。
export default defineConfig({
  plugins: [react()],
  base: './',
})
