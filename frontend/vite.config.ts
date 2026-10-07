import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `npm run dev:https` serves over https so the tablet's live camera works on the LAN address
// (browsers only allow the camera on https or localhost). Plain `npm run dev` is unchanged.

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    port: 5173,
    // Allow temporary public tunnel addresses so shared WhatsApp links can be opened on other phones
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
}))
