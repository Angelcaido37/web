import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Esto permite que tu app funcione en cualquier subcarpeta (como /web/paneg/)
  base: './', 
})