import { defineConfig } from "vite";

// Dev server config:
// - host: 0.0.0.0 agar bisa diakses dari preview / LAN
// - allowedHosts: true agar host preview ( *.e2b.app, ngrok, dsb ) tidak di-block
//   oleh pemeriksaan host bawaan Vite (HTTP 403 "Blocked request").
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: false,
    allowedHosts: true
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true
  }
});
