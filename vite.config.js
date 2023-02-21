import {viteImportExtjsRequires} from './src/index';
export default {
    optimizeDeps: {
        force: true,
    },
    plugins: [
        viteImportExtjsRequires({
            Some: '/test/lib/Some/src',
            overrides:'/test/lib/overrides'
        })
    ]
}
