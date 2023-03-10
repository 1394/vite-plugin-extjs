import { viteImportExtjsRequires } from './src/index';

export default {
    resolve: {
        preserveSymlinks: true,
    },
    plugins: [
        viteImportExtjsRequires({
            mappings: {
                Ext: false,
                Some: '/test/lib/Some/src',
                overrides: '/test/lib/overrides',
                Coon: 'node_modules/ru.coon/src',
            },
            include: ['test/Application.js'],
            exclude: ['test/lib/Some/src/log.js'],
            debug: true,
        }),
    ],
};
