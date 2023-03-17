import viteExtJS from './src/index';
import Inspect from 'vite-plugin-inspect';

export default {
    resolve: {
        preserveSymlinks: true,
    },
    plugins: [
        Inspect(),
        viteExtJS({
            mappings: {
                Ext: false,
                Some: '/test/lib/Some/src',
                // overrides: '/test/lib/overrides',
                // Coon: 'node_modules/ru.coon/src',
            },
            entryPoints: ['app.js', 'Application.js'],
            exclude: ['test/lib/Some/src/log.js'],
            debug: true,
        }),
    ],
};
