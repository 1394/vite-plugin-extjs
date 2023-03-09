import fg from 'fast-glob';
import { normalizePath } from 'vite';
import { access, readFile, constants } from 'node:fs/promises';
import pc from 'picocolors';
import { ExtAnalyzer } from 'extjs-code-analyzer';
import { Logger } from './Logger.js';

const PLUGIN_NAME = 'vite-plugin-extjs';
let DEBUG = false;
let MODE;

function realpath(path) {
    return normalizePath(process.cwd() + '\\' + path).replace(/\\/g, '/');
}

function alwaysSkip(id) {
    const checks = [
        id.endsWith('.css'),
        id.endsWith('.scss'),
        id.endsWith('.html'),
        id.endsWith('?direct'),
        id.includes('node_modules/.vite'),
        id.includes('vite@'),
    ];
    return checks.some(Boolean);
}

function shouldSkip(id, exclude = []) {
    const checks = [exclude.some((pattern) => new RegExp(pattern).test(id))];
    return checks.some(Boolean);
}

const viteImportExtjsRequires = ({ mappings = {}, debug = false, exclude = [], include = [] }) => {
    Logger.config = debug;
    Logger.prefix = PLUGIN_NAME;
    // noinspection JSUnusedGlobalSymbols
    return {
        name: PLUGIN_NAME,
        async buildStart(options) {
            // TODO get acorn parse || parse options
        },
        async config(config, { mode }) {
            MODE = mode;
            for (const namespace in mappings) {
                const basePath = mappings[namespace];
                if (basePath) {
                    Logger.info(`Resolving namespace "${namespace}"...`);
                    try {
                        const realPath = realpath(basePath);
                        await access(realPath, constants.R_OK);
                        Logger.info(`Resolved: ${realPath}`);
                        const timeLabel = `${pc.cyan('[ExtAnalyzer]')} Analyzed "${namespace}" in`;
                        console.time(timeLabel);
                        const paths = await fg(realPath + '/**/*.js');
                        for (const path of paths) {
                            if (!path.endsWith('.js')) {
                                continue;
                            }
                            const mustInclude = include.length && include.some((pattern) => path.includes(pattern));
                            if (!mustInclude) {
                                if (shouldSkip(path, exclude)) {
                                    Logger.warn(`- Skipping: ${path}`);
                                    continue;
                                }
                            }
                            const source = await readFile(path);
                            ExtAnalyzer.analyze(source.toString(), path);
                        }
                        if (!((typeof DEBUG === 'boolean' && !DEBUG) || (DEBUG !== true && !DEBUG.log))) {
                            return;
                        }
                        console.timeEnd(timeLabel);
                    } catch (e) {
                        Logger.warn(e.message);
                    }
                }
            }
            ExtAnalyzer.classManager.resolveImports();
        },
        async transform(code, id) {
            const cleanId = (id.includes('?') && id.slice(0, id.indexOf('?'))) || id;
            if (alwaysSkip(cleanId)) {
                Logger.warn(`- Ignoring: ${id}`);
                return;
            }
            const mustInclude = include.length && include.some((pattern) => id.includes(pattern));
            if (!mustInclude) {
                if (typeof ExtAnalyzer.fileMap[cleanId] !== 'object') {
                    Logger.warn(`- Ignoring(not mapped): ${id}`);
                    return;
                }
                if (shouldSkip(id, exclude)) {
                    Logger.warn(` - Skipping: ${id}`);
                    return;
                }
            }
            Logger.info(`+ Analyzing: ${id}`);
            let fileMeta;
            try {
                fileMeta = ExtAnalyzer.getFile(cleanId) || ExtAnalyzer.analyze(code, cleanId, true);
            } catch (e) {
                Logger.error(e.message, e.stack);
                return;
            }
            const importPaths = fileMeta.getImportsPaths();
            if (!importPaths.length) {
                return;
            }
            code = fileMeta.getTransformedCode();
            let importString = '';
            importPaths.forEach((path) => {
                importString += `import '${path}';\n`;
            });
            if (importString.length) {
                code = `/*** <${PLUGIN_NAME}> ***/\n${importString}/*** </${PLUGIN_NAME}> ***/\n\n${code}`;
            }
            return { code };
        },
    };
};
export { viteImportExtjsRequires };
