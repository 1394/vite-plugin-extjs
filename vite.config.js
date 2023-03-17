import { vitePluginExtJS } from './src/index';
import Inspect from 'vite-plugin-inspect';
export default {
    resolve: {
        preserveSymlinks: true,
    },
    plugins: [
        Inspect(),
        vitePluginExtJS({
            mappings: {
                Ext: false,
                Some: '/test/lib/Some/src',
                // overrides: '/test/lib/overrides',
                // Coon: 'node_modules/ru.coon/src',
            },
            entryPoints: ['test/Application.js'],
            exclude: ['test/lib/Some/src/log.js'],
            debug: true,
        }),
    ],
};
