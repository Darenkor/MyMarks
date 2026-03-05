import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true, // Exposes on 0.0.0.0 so other devices on the LAN can access
        port: 5173,
    },
    build: {
        outDir: 'dist',
    },
});
