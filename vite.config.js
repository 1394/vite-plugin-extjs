import viteExtJS from './src/index';
import Inspect from 'vite-plugin-inspect';

export default {
    resolve: {
        preserveSymlinks: true,
    },
    plugins: [
        Inspect(),
        viteExtJS({
            paths: {
                Ext: false,
                Some: '/test/lib/Some/src',
                // overrides: '/test/lib/overrides',
                // Coon: 'node_modules/ru.coon/src',
            },
            //TODO implement
            disableCachingParam: '_dc',
            bundleScss: true,
            // TODO relative to build path
            scssOutFile: 'tmp/bundle.scss',
            entryPoints: ['app.js', 'Application.js'],
            exclude: ['test/lib/Some/src/log.js'],
            debug: true,
        }),
    ],
};
