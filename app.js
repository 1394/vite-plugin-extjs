import './test/Application';
// import { classMap } from 'virtual:vite-plugin-extjs';

console.log('Application Started.');
// console.log(classMap);
if (import.meta.hot) {
    import.meta.hot.on('theme-update-begin', () => {
        console.log('Theme stylesheet is reloading...');
    });

    import.meta.hot.on('theme-update-end', () => {
        console.log('Done.');
    });
}
