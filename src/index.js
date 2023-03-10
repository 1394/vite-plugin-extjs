import fg from 'fast-glob';
import { normalizePath } from 'vite';
import { access, readFile, constants } from 'node:fs/promises';
import pc from 'picocolors';
import { ExtAnalyzer } from 'extjs-code-analyzer';
import { Logger } from './Logger.js';

const PLUGIN_NAME = 'vite-plugin-extjs';

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

async function buildMap(basePath, namespace, include = [], exclude = []) {
    basePath = Array.isArray(basePath) ? basePath : [basePath];
    const globPaths = [];
    for (const path of basePath) {
        const realPath = realpath(path);
        try {
            await access(realPath, constants.R_OK);
            Logger.info(`Resolved: ${realPath}`);
            globPaths.push(realPath + '/**/*.js');
        } catch (e) {
            throw e;
        }
    }
    const paths = await fg(globPaths);
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
}

const viteImportExtjsRequires = ({ mappings = {}, debug = false, exclude = [], include = [] }) => {
    Logger.config = debug;
    Logger.prefix = PLUGIN_NAME;
    const virtualModuleId = `virtual:${PLUGIN_NAME}`;
    const resolvedVirtualModuleId = '\0' + virtualModuleId;
    // noinspection JSUnusedGlobalSymbols
    return {
        name: PLUGIN_NAME,
        resolveId(id) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
        },
        load(id) {
            if (id === resolvedVirtualModuleId) {
                return `export const classMap = ${ExtAnalyzer.classManager.classMapToJSON()};`;
            }
        },
        async buildStart(options) {
            // TODO get acorn parse || parse options
        },
        async config() {
            for (const namespace in mappings) {
                const basePath = mappings[namespace];
                if (basePath) {
                    Logger.info(`Resolving namespace "${namespace}"...`);
                    try {
                        const timeLabel = `${pc.cyan(`[${PLUGIN_NAME}]`)} Analyzed "${namespace}" in`;
                        console.time(timeLabel);
                        await buildMap(basePath, namespace, include, exclude);
                        console.timeEnd(timeLabel);
                        ExtAnalyzer.classManager.resolveImports();
                    } catch (e) {
                        Logger.warn(e.message);
                    }
                }
            }
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
            const fileMeta = ExtAnalyzer.getFile(cleanId) || ExtAnalyzer.analyze(code, cleanId, true);
            code = fileMeta.applyCodeTransforms(code);
            if (fileMeta.isImportsInjected) {
                Logger.warn('- Imports already injected. Skipping.');
                return { code };
            }
            const importPaths = fileMeta.getImportsPaths();
            if (!importPaths.length) {
                Logger.info('- Empty import paths');
                return { code };
            }
            let importString = '';
            importPaths.forEach((path) => {
                importString += `import '${path}';\n`;
            });
            if (importString.length) {
                fileMeta.code =
                    code = `/*** <${PLUGIN_NAME}> ***/\n${importString}/*** </${PLUGIN_NAME}> ***/\n\n${code}`;
                fileMeta.isImportsInjected = true;
            }
            return { code };
        },
    };
};
export { viteImportExtjsRequires };
