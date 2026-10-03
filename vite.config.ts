/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// base: Cloudflare Pages publica na raiz do domínio. VITE_BASE só se o site for servido num subcaminho.
export default defineConfig(() => ({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // /api/* (boletos) roda no Worker: em desenvolvimento, `npm run dev:api` sobe o Worker na porta 8787
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  // nfe/ é um projeto à parte (dependências e testes próprios: cd nfe && npm test)
  test: { exclude: [...configDefaults.exclude, 'nfe/**'] },
}))
