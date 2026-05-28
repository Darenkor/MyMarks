import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
    const isPortable = mode === 'portable';

    return {
        base: isPortable ? './' : '/MyMarks/',
        server: {
            host: true,
            port: 5173,
        },
        build: {
            outDir: isPortable ? 'dist-portable' : 'dist',
        },
        plugins: isPortable
            ? [import('vite-plugin-singlefile').then(m => m.viteSingleFile())]
            : [],
    };
});
