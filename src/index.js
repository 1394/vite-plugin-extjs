import fg from 'fast-glob';
import { normalizePath } from 'vite';
import { access, readFile, constants } from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { fork } from 'node:child_process';
import { EOL } from 'node:os';
import { copy, ensureFile, remove, ensureSymlink } from 'fs-extra/esm';
import pc from 'picocolors';
import { ExtAnalyzer } from 'extjs-code-analyzer/src/Analyzer';
import { Logger } from './Logger.js';

const PLUGIN_NAME = 'vite-plugin-extjs';

const assets = ['scss'];
const scripts = ['js'];
let assetsMap = [];
const defaultCssFileName = 'theme.css';

function resolvePath(path) {
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
    // TODO use https://www.npmjs.com/package/picomatch
    const checks = [exclude.some((pattern) => new RegExp(pattern).test(id))];
    return checks.some(Boolean);
}

async function buildMap(basePath, namespace, include = [], exclude = []) {
    basePath = Array.isArray(basePath) ? basePath : [basePath];
    const globPaths = [];
    for (const path of basePath) {
        const realPath = resolvePath(path);
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

async function transformThemeBundle(
    themeBundle,
    sassFilePath,
    { setSassVars = [], addImports, replaceImportPaths, assetsBundleSource, imageSearchPath }
) {
    await remove(themeBundle);
    await ensureFile(themeBundle);
    const fileReadStream = createReadStream(sassFilePath);
    const fileWriteStream = createWriteStream(themeBundle);
    const rl = readline.createInterface({
        input: fileReadStream,
        crlfDelay: Infinity,
    });
    for (const sassVar of setSassVars) {
        fileWriteStream.write(sassVar + EOL);
    }
    if (addImports && Array.isArray(addImports.before)) {
        for (const importPath of addImports.before) {
            fileWriteStream.write(`@import '${importPath}';` + EOL);
        }
    }
    for await (let line of rl) {
        if (replaceImportPaths && replaceImportPaths.search && replaceImportPaths.replace) {
            line = line.replace(replaceImportPaths.search, replaceImportPaths.replace);
        }
        if (imageSearchPath) {
            if (line.includes('$image-search-path')) {
                fileWriteStream.write(`$image-search-path: '${imageSearchPath}';` + EOL);
                continue;
            }
        }
        fileWriteStream.write(line + EOL);
    }
    if (addImports && Array.isArray(addImports.after)) {
        for (const importPath of addImports.after) {
            fileWriteStream.write(`@import '${importPath}';` + EOL);
        }
    }
    if (assetsBundleSource && assetsBundleSource.length) {
        fileWriteStream.write(assetsBundleSource);
    }

    fileWriteStream.close();
    fileReadStream.close();
}

async function buildTheme(theme, resolvedConfig) {
    let assetsBundleSource = '';
    for (const path of assetsMap) {
        assetsBundleSource += `/* ${path} */${EOL}` + (await readFile(path)).toString() + EOL;
    }
    const {
        basePath,
        sassPath,
        sassFile,
        outCssFile,
        outputDir,
        setSassVars,
        replaceImportPaths,
        addImports,
        imageSearchPath,
    } = theme;
    if (basePath) {
        const themeBundle = resolvePath([basePath, sassPath, '_bundle.scss'].filter(Boolean).join('/'));
        try {
            const sassFilePath = resolvePath([basePath, sassPath, sassFile].filter(Boolean).join('/'));
            // Transform theme sass file
            await transformThemeBundle(themeBundle, sassFilePath, {
                setSassVars,
                replaceImportPaths,
                addImports,
                assetsBundleSource,
                imageSearchPath: imageSearchPath || resolvePath(basePath),
            });

            const fashionCliPath = resolvePath('/node_modules/fashion-cli/fashion.js');
            // Run fashion-cli
            Logger.warn('[Fashion] Compiling sass to css...');
            const fashion = fork(fashionCliPath, [
                'compile',
                themeBundle,
                resolvePath(basePath + '/' + (outCssFile || defaultCssFileName)),
            ]);
            fashion.on('exit', async function (code) {
                Logger.warn('[Fashion] Finished with exit code ' + code);
                // Copying theme to outputDir
                const themeDestDir = resolvePath([resolvedConfig.build.outDir, outputDir].filter(Boolean).join('/'));
                if (resolvedConfig.command === 'build' && resolvedConfig.mode === 'production') {
                    Logger.warn('Copying compiled theme files...');
                    await copy(resolvePath(basePath), themeDestDir, { overwrite: true });
                }
                Logger.warn('Finished.');
            });
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
    theme = {},
    disableCachingParam = '_dc',
    symlink,
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
                await buildTheme(theme, resolvedConfig);
            }
        },
        async configResolved(config) {
            resolvedConfig = config;
            const { command, mode } = config;
            const namespaces = Object.keys(paths || {});
            if ((command === 'serve' && mode === 'production') || namespaces.length === 0) {
                return;
            }
            assetsMap = [];
            for (const ns of namespaces) {
                let basePath = paths[ns];
                if (basePath) {
                    if (typeof symlink === 'object' && mode === 'development') {
                        if (symlink[ns]) {
                            Logger.warn(`Making symlink for "${ns}"...`);
                            await ensureSymlink(resolvePath(basePath), resolvePath(symlink[ns], 'dir'));
                            basePath = symlink[ns];
                        }
                    }
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
                await buildTheme(theme, resolvedConfig);
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
        transformIndexHtml() {
            const { basePath, outCssFile, outputDir } = theme;
            if (basePath) {
                const cssDir =
                    resolvedConfig.command === 'build' && resolvedConfig.mode === 'production' ? outputDir : basePath;
                return [
                    {
                        tag: 'link',
                        attrs: {
                            rel: 'stylesheet',
                            type: 'text/css',
                            href: [cssDir, outCssFile || defaultCssFileName].join('/'),
                        },
                        injectTo: 'head',
                    },
                ];
            }
        },
    };
};
export default viteExtJS;
