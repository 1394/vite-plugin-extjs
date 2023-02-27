import {viteImportExtjsRequires} from './src/index';

export default {
    optimizeDeps: {
        force: true,
    },
    plugins: [
        viteImportExtjsRequires(
            {
                mappings: {
                    Some: '/test/lib/Some/src',
                    overrides: '/test/lib/overrides',
                    Ext: false
                }
            }
        )
    ]
}
