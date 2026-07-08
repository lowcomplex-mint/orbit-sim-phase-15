import { defineConfig } from 'vite';

export default defineConfig({
  // host: true lets you open the dev server from a phone on the same LAN,
  // which is how we test the mobile UI before packaging for Android.
  // The port comes from the PORT env var when a tool assigns one.
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
});
