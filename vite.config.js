import importExt from './src/main';
export default {
    plugins: [
        importExt({Some: '/test/lib/Some/src'})
    ]
}