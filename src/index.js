import { EOL } from 'node:os';
import { ensureSymlink } from 'fs-extra/esm';
import pc from 'picocolors';
import { ExtAnalyzer } from 'extjs-code-analyzer/src/Analyzer';
import { Logger } from './Logger.js';
import { ClassMap } from './ClassMap.js';
import { Path } from './Path.js';
import { Theme } from './Theme.js';

const PLUGIN_NAME = 'vite-plugin-extjs';

let classMap = new ClassMap();
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
                await Theme.build(theme, resolvedConfig, classMap.assetsMap);
            }
        },
        async configResolved(config) {
            resolvedConfig = config;
            const { command, mode } = config;
            const namespaces = Object.keys(paths || {});
            if ((command === 'serve' && mode === 'production') || namespaces.length === 0) {
                return;
            }
            classMap.reset();
            for (const ns of namespaces) {
                let basePath = paths[ns];
                if (basePath) {
                    if (typeof symlink === 'object' && mode === 'development') {
                        if (symlink[ns]) {
                            Logger.warn(`Making symlink for "${ns}"...`);
                            await ensureSymlink(Path.resolve(basePath), Path.resolve(symlink[ns], 'dir'));
                            basePath = symlink[ns];
                        }
                    }
                    Logger.warn(`Resolving namespace "${ns}"...`);
                    try {
                        const timeLabel = `${pc.cyan(`[${PLUGIN_NAME}]`)} Analyzed "${ns}" in`;
                        !Logger.skip('info') && console.time(timeLabel);
                        await classMap.build(basePath, ns, entryPoints, exclude);
                        !Logger.skip('info') && console.timeEnd(timeLabel);
                        ExtAnalyzer.classManager.resolveImports();
                    } catch (e) {
                        Logger.warn(e.message);
                    }
                }
            }
            if (command === 'serve' && mode === 'development') {
                await Theme.build(theme, resolvedConfig, classMap.assetsMap);
            }
        },
        async transform(code, id) {
            // Prevent transforming of Ext.loader scripts
            if (id.includes(`?${disableCachingParam}=`)) {
                return { code };
            }
            const cleanId = (id.includes('?') && id.slice(0, id.indexOf('?'))) || id;
            if (Path.isIgnore(cleanId)) {
                Logger.info(`- Ignoring (always skip): ${id}`);
                return { code };
            }
            const mustInclude = entryPoints.length && entryPoints.some((pattern) => id.includes(pattern));
            if (!mustInclude) {
                if (typeof ExtAnalyzer.fileMap[cleanId] !== 'object') {
                    Logger.info(`- Ignoring (not mapped): ${id}`);
                    return { code };
                }
                if (Path.isMatch(id, exclude)) {
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
                            href: [cssDir, outCssFile || Theme.defaultCssFileName].join('/'),
                        },
                        injectTo: 'head',
                    },
                ];
            }
        },
    };
};
export default viteExtJS;
