import { normalizePath } from 'vite';
import pm from 'picomatch';

export class Path {
    static resolve(path) {
        return normalizePath(process.cwd() + '\\' + path).replace(/\\/g, '/');
    }

    static isMatch(path, paths = []) {
        return pm.isMatch(path, paths);
    }

    static isIgnore(path) {
        return [
            path.endsWith('.css'),
            path.endsWith('.scss'),
            path.endsWith('.html'),
            path.endsWith('?direct'),
            path.includes('node_modules/.vite'),
            path.includes('vite@'),
        ].some(Boolean);
    }
}