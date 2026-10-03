import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// base: Cloudflare Pages publica na raiz do domínio. VITE_BASE só se o site for servido num subcaminho.
export default defineConfig(() => ({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // /api/* (boletos) roda no Worker: em desenvolvimento, `npm run dev:api` sobe o Worker na porta 8787
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
}))
