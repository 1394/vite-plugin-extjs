import fg from 'fast-glob';
import { normalizePath } from 'vite';
import { access, readFile, appendFile, constants } from 'node:fs/promises';
import { copy } from 'fs-extra/esm';
import pc from 'picocolors';
import { ExtAnalyzer } from 'extjs-code-analyzer/src/Analyzer';
import { Logger } from './Logger.js';

const PLUGIN_NAME = 'vite-plugin-extjs';

const assets = ['scss'];
const scripts = ['js'];
const assetsMap = [];

function realpath(path) {
    return normalizePath(process.cwd() + '\\' + path).replace(/\\/g, '/');
}

//TODO use https://github.com/rollup/plugins/tree/master/packages/pluginutils#createfilter
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
            globPaths.push(realPath + `/**/*.+(${[...scripts, ...assets].join('|')})`);
        } catch (e) {
            throw e;
        }
    }
    const paths = await fg(globPaths);
    for (const path of paths) {
        if (assets.length && assets.some((ext) => path.endsWith(`.${ext}`))) {
            assetsMap.push(path);
            continue;
        }
        if (scripts.length && !scripts.some((ext) => path.endsWith(`.${ext}`))) {
            continue;
        }
        const mustInclude = include.length && include.some((pattern) => path.includes(pattern));
        if (!mustInclude) {
            if (shouldSkip(path, exclude)) {
                Logger.info(`- Skipping: ${path}`);
                continue;
            }
        }
        const source = await readFile(path);
        ExtAnalyzer.analyze(source.toString(), path);
    }
}

const viteExtJS = ({
    paths = {},
    debug = false,
    exclude = [],
    entryPoints = [],
    theme = { path: '', sassFile: '', outPath: '', outSassFile: 'theme.scss' },
}) => {
    Logger.config = debug;
    Logger.prefix = PLUGIN_NAME;
    const virtualModuleId = `virtual:${PLUGIN_NAME}`;
    const resolvedVirtualModuleId = '\0' + virtualModuleId;
    let viteConfig;

    // noinspection JSUnusedGlobalSymbols
    return {
        name: PLUGIN_NAME,
        // TODO maybe check ignored files here
        resolveId(id) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
        },
        load(id) {
            if (id === resolvedVirtualModuleId) {
                return `export const classMap = ${ExtAnalyzer.classManager.classMapToJSON()};
                        export const loaderPaths = ${JSON.stringify(paths)};`;
            }
        },
        async closeBundle() {
            //TODO get mode - serve:return
            let assetsBundleSource = '';
            for (const path of assetsMap) {
                assetsBundleSource += `/* ${path} */\n` + (await readFile(path)).toString() + '\n';
            }
            const { path, sassFile, outPath, outSassFile } = theme;
            if (path && sassFile && outPath) {
                const themeBundle = realpath(viteConfig.build.outDir + '/' + outPath + '/' + outSassFile);
                try {
                    Logger.info('Copying theme files...');
                    await copy(realpath(path), realpath(viteConfig.build.outDir + '/' + outPath), {
                        overwrite: true,
                    });
                    await copy(realpath(path + '/' + sassFile), themeBundle, {
                        overwrite: true,
                    });
                    if (assetsBundleSource.length) {
                        Logger.info('Appending component styles...');
                        await appendFile(themeBundle, assetsBundleSource);
                    }
                } catch (e) {
                    console.error(e);
                    process.exit(1);
                }
            }
        },
        async config(config) {
            viteConfig = config;
            //TODO if serve mode - return
            for (const namespace in paths) {
                const basePath = paths[namespace];
                if (basePath) {
                    Logger.info(`Resolving namespace "${namespace}"...`);
                    try {
                        const timeLabel = `${pc.cyan(`[${PLUGIN_NAME}]`)} Analyzed "${namespace}" in`;
                        !Logger.skip('info') && console.time(timeLabel);
                        await buildMap(basePath, namespace, entryPoints, exclude);
                        !Logger.skip('info') && console.timeEnd(timeLabel);
                        ExtAnalyzer.classManager.resolveImports();
                    } catch (e) {
                        Logger.warn(e.message);
                    }
                }
            }
        },
        async transform(code, id) {
            // Prevent transforming of Ext.loader scripts
            // TODO get from config "disableCachingParam"
            if (id.includes('?_dc=')) {
                return { code };
            }
            const cleanId = (id.includes('?') && id.slice(0, id.indexOf('?'))) || id;
            if (alwaysSkip(cleanId)) {
                Logger.info(`- Ignoring (always skip): ${id}`);
                return { code };
            }
            const mustInclude = entryPoints.length && entryPoints.some((pattern) => id.includes(pattern));
            if (!mustInclude) {
                if (typeof ExtAnalyzer.fileMap[cleanId] !== 'object') {
                    Logger.info(`- Ignoring (not mapped): ${id}`);
                    return { code };
                }
                if (shouldSkip(id, exclude)) {
                    Logger.info(` - Skipping: ${id}`);
                    return { code };
                }
            }
            if (id === 'D:/projects/web-billing/frontend/app/desktop/src/Application.js') {
                debugger;
            }
            const fileMeta = ExtAnalyzer.sync(code, cleanId);
            if (fileMeta.isCached && fileMeta.transformedCode) {
                Logger.info(`- Ignoring (not changed): ${id}`);
                return { code: fileMeta.transformedCode };
            }

            Logger.info(`+ Analyzing: ${id}`);

            code = fileMeta.applyCodeTransforms(code);
            if (fileMeta.transformedCode) {
                Logger.info(`+ ${fileMeta.appliedTransformations} transformations applied.`);
            }
            const importPaths = fileMeta.getImportsPaths();
            if (!importPaths.length) {
                Logger.info('- Empty import paths');
                return { code };
            }
            let importString = '';
            for (const path of importPaths) {
                if (path === id) continue;
                importString += `import '${path}';\n`;
            }
            if (importString.length) {
                // TODO generate && return sourceMap
                fileMeta.transformedCode =
                    code = `/*** <${PLUGIN_NAME}> ***/\n${importString}/*** </${PLUGIN_NAME}> ***/\n\n${code}`;
                Logger.info(`+ ${importPaths.length} imports injected.`);
            }
            return { code };
        },
    };
};
export default viteExtJS;
