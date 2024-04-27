import viteExtJS from './src/index';

export default {
    resolve: {
        preserveSymlinks: true,
    },
    optimizeDeps: {
        exclude: ['theme'],
    },
    plugins: [
        viteExtJS({
            paths: {
                Ext: false,
                Some: '/test/lib/Some/src',
            },
            disableCachingParam: '_dc',
            entryPoints: ['app.js', 'Application.js'],
            exclude: ['test/lib/Some/src/log.js'],
            debug: true,
            theme: {
                basePath: '/node_modules/theme',
                sassFile: 'app.scss',
            },
        }),
    ],
};
