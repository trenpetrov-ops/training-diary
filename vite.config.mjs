import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    base: './',
    publicDir: false,
    server: {
        host: '127.0.0.1',
        port: 5173
    },
    preview: {
        host: '127.0.0.1',
        port: 4173
    },
    build: {
        outDir: 'www',
        emptyOutDir: true,
        target: 'es2020',
        cssMinify: false,
        rollupOptions: {
            input: resolve(process.cwd(), 'index.html')
        }
    }
});
