import { access, constants, readFile } from 'node:fs/promises';
import { Logger } from './Logger.js';
import fg from 'fast-glob';
import { ExtAnalyzer } from 'extjs-code-analyzer/src/Analyzer';
import { Path } from './Path.js';
export class ClassMap {
    assetsMap = [];

    constructor(config = { scripts: ['js'], assets: ['scss'] }) {
        this.scripts = config.scripts;
        this.assets = config.assets;
    }

    reset() {
        this.assetsMap = [];
    }

    async build(basePath, namespace, entryPoints = [], exclude = []) {
        basePath = Array.isArray(basePath) ? basePath : [basePath];
        const patterns = [];
        for (const path of basePath) {
            const realPath = Path.resolve(path);
            await access(realPath, constants.R_OK);
            Logger.info(`Resolved: ${realPath}`);
            patterns.push(realPath + `/**/*.+(${[...this.scripts, ...this.assets].join('|')})`);
        }
        for (const path of await fg(patterns)) {
            if (this.assets.length && this.assets.some((ext) => path.endsWith(`.${ext}`))) {
                this.assetsMap.push(path);
                continue;
            }
            if (this.scripts.length && !this.scripts.some((ext) => path.endsWith(`.${ext}`))) {
                continue;
            }
            if (Path.isMatch(path, exclude)) {
                Logger.info(`- Skipping excluded: ${path}`);
                continue;
            }
            const source = await readFile(path);
            ExtAnalyzer.analyze(source.toString(), Path.relative(path));
        }
    }

    async add(path) {
        const source = await readFile(path);
        try {
            ExtAnalyzer.analyze(source.toString(), Path.relative(path), true);
            return ExtAnalyzer.getFile(path);
        } catch (e) {
            Logger.error(e.message, path);
        }
    }
}
