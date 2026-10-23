import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for WebXR when the headset opens the game over Wi-Fi
// (https://<PC-IP>:5173). On the PC itself, https://localhost:5173 works too.
export default defineConfig({
  base: './', // relative paths, so the built app works from any folder or host
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
    strictPort: true, // always 5173, so the address on the Quest never changes
  },
});
