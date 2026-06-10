import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Load combined config if present with graceful local fallbacks
let backendPort = 8080;
let authbluePort = 5001;
let frontendPort = 5173;
let enableSso = true;

try {
  const configPath = path.resolve(__dirname, '../config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.BACKEND_PORT !== undefined) backendPort = config.BACKEND_PORT;
    if (config.AUTHBLUE_PORT !== undefined) authbluePort = config.AUTHBLUE_PORT;
    if (config.FRONTEND_PORT !== undefined) frontendPort = config.FRONTEND_PORT;
    if (config.ENABLE_SSO !== undefined) enableSso = config.ENABLE_SSO;
  }
} catch (e) {
  console.warn("Failed to load combined root config.json, using standard defaults:", e);
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
      '/v1': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      }
    }
  },
  define: {
    'import.meta.env.VITE_ENABLE_SSO': JSON.stringify(String(enableSso)),
    'import.meta.env.VITE_SSO_LOGIN_URL': JSON.stringify(`http://127.0.0.1:${authbluePort}/login`),
    'import.meta.env.VITE_SSO_LOGOUT_URL': JSON.stringify(`http://127.0.0.1:${authbluePort}/logout`),
  }
})
