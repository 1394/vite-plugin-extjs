import fg from 'fast-glob';
import { normalizePath } from 'vite';
import { access, readFile, appendFile, constants } from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { EOL } from 'node:os';
import { copy, ensureFile, remove } from 'fs-extra/esm';
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

async function copyThemeFiles(theme, resolvedConfig) {
    let assetsBundleSource = '';
    for (const path of assetsMap) {
        assetsBundleSource += `/* ${path} */${EOL}` + (await readFile(path)).toString() + EOL;
    }
    const { path, sassFile, outPath, outSassFile, setSassVars } = theme;
    if (path && sassFile) {
        const themeBundle = realpath(
            [resolvedConfig.build.outDir, outPath, outSassFile || '_bundle.scss'].filter(Boolean).join('/')
        );
        try {
            Logger.warn('Copying theme files...');
            // Copy resources
            await copy(realpath(path), realpath([resolvedConfig.build.outDir, outPath].filter(Boolean).join('/')), {
                overwrite: true,
            });
            // Prepend css vars
            if (Array.isArray(setSassVars) && setSassVars.length) {
                await remove(themeBundle);
                await ensureFile(themeBundle);
                const fileReadStream = createReadStream(realpath(path + '/' + sassFile));
                const fileWriteStream = createWriteStream(themeBundle);
                const rl = readline.createInterface({
                    input: fileReadStream,
                    crlfDelay: Infinity,
                });
                for (const sassVar of setSassVars) {
                    fileWriteStream.write(sassVar + EOL);
                }
                for await (const line of rl) {
                    fileWriteStream.write(line + EOL);
                }
                fileWriteStream.write(assetsBundleSource);
                fileWriteStream.close();
                fileReadStream.close();
            } else {
                // Copy theme sass file
                await copy(realpath(path + '/' + sassFile), themeBundle, {
                    overwrite: true,
                });
            }
            // Append component sass files to theme bundle
            if (assetsBundleSource.length) {
                Logger.warn('Appending component styles...');
                await appendFile(themeBundle, assetsBundleSource);
            }
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    }
}

const viteExtJS = ({
    paths = {},
    debug = false,
    exclude = [],
    entryPoints = [],
    theme = { path: '', sassFile: '', outPath: '', outSassFile: '', setSassVars: [] },
    disableCachingParam = '_dc',
}) => {
    Logger.config = debug;
    Logger.prefix = PLUGIN_NAME;
    const virtualModuleId = `virtual:${PLUGIN_NAME}`;
    const resolvedVirtualModuleId = '\0' + virtualModuleId;
    let resolvedConfig;
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
            if (resolvedConfig.command === 'build' && resolvedConfig.mode === 'production') {
                await copyThemeFiles(theme, resolvedConfig);
            }
        },
        async configResolved(config) {
            resolvedConfig = config;
            const { command, mode } = config;
            const namespaces = Object.keys(paths || {});
            if ((command === 'serve' && mode === 'production') || namespaces.length === 0) {
                return;
            }
            for (const ns of namespaces) {
                const basePath = paths[ns];
                if (basePath) {
                    Logger.warn(`Resolving namespace "${ns}"...`);
                    try {
                        const timeLabel = `${pc.cyan(`[${PLUGIN_NAME}]`)} Analyzed "${ns}" in`;
                        !Logger.skip('info') && console.time(timeLabel);
                        await buildMap(basePath, ns, entryPoints, exclude);
                        !Logger.skip('info') && console.timeEnd(timeLabel);
                        ExtAnalyzer.classManager.resolveImports();
                    } catch (e) {
                        Logger.warn(e.message);
                    }
                }
            }
            if (command === 'serve' && mode === 'development') {
                await copyThemeFiles(theme, resolvedConfig);
            }
        },
        async transform(code, id) {
            // Prevent transforming of Ext.loader scripts
            if (id.includes(`?${disableCachingParam}=`)) {
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
                importString += `import '${path}';` + EOL;
            }
            if (importString.length) {
                // TODO generate && return sourceMap
                fileMeta.transformedCode =
                    code = `/* <${PLUGIN_NAME}> */${EOL}${importString}/* </${PLUGIN_NAME}> */${EOL}${code}`;
                Logger.info(`+ ${importPaths.length} imports injected.`);
            }
            return { code };
        },
    };
};
export default viteExtJS;
