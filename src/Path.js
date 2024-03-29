import { relative, posix } from 'node:path';
import pm from 'picomatch';

function slash(p) {
    return p.replace(/\\/g, '/');
}

export function normalizePath(id) {
    const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
    return posix.normalize(isWindows ? slash(id) : id);
}

export class Path {
    static resolve(path, absolute = true) {
        return normalizePath((absolute ? process.cwd() : '') + '/' + path).replace(/\\|\/\//g, '/');
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
            path.endsWith('.xml'),
        ].some(Boolean);
    }

    static relative(path) {
        return this.resolve('/' + relative(process.cwd(), path), false);
    }
}
