import importExt from './src/main';
export default {
    optimizeDeps: {
        force: true,
    },
    plugins: [
        importExt({
            Some: '/test/lib/Some/src',
            overrides:'/test/lib/overrides'
        })
    ]
}