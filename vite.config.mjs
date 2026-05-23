import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
    base: './',
    publicDir: false,
    build: {
        outDir: 'www',
        emptyOutDir: true,
        target: 'es2020',
        rollupOptions: {
            input: resolve(process.cwd(), 'index.html')
        }
    }
});
