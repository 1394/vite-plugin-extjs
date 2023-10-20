import { EOL } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ensureSymlink } from 'fs-extra/esm';
import pc from 'picocolors';
import MagicString from 'magic-string';
import { ExtAnalyzer } from 'extjs-code-analyzer/src/Analyzer';
import { Logger } from './Logger.js';
import { ClassMap } from './ClassMap.js';
import { Path } from './Path.js';
import { Theme } from './Theme.js';

const PLUGIN_NAME = 'vite-plugin-extjs';
let classMap = new ClassMap();
let skipThemeBuild = false;
let totalModules = 0;
let sourceMapIsEnabled = false;
const pluralize = (count, noun, suffix = 's') => `${count} ${noun}${count !== 1 ? suffix : ''}`;

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
    const ignoredNamespaces = [];
    const globalMissingImports = {};
    const searchPaths = ((typeof paths === 'object' && Object.values(paths).filter(Boolean)) || [])
        .concat((typeof symlink === 'object' && Object.values(symlink).filter(Boolean)) || [])
        .flat()
        .map((path) => Path.resolve(path))
        .map((path) => (String(path).endsWith('/') ? path + '**/*.js' : path + '/**/*.js'));
    return {
        name: PLUGIN_NAME,
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
                Logger.warn('Total processed modules: ' + totalModules + '.');
                await Theme.build(theme, resolvedConfig, classMap.assetsMap);
            }
        },
        async configResolved(config) {
            Logger.info('Config is resolved.');
            resolvedConfig = config;
            sourceMapIsEnabled =
                resolvedConfig.build?.sourcemap === true ||
                resolvedConfig.build?.rollupOptions?.output?.sourcemap === true;
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
                            await ensureSymlink(Path.resolve(basePath), Path.resolve(symlink[ns]), 'junction');
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
                        Logger.fatal(e.message);
                    }
                } else {
                    ignoredNamespaces.push(ns);
                }
            }
            if (!skipThemeBuild && command === 'serve' && mode === 'development') {
                await Theme.build(theme, resolvedConfig, classMap.assetsMap);
            }
            skipThemeBuild = false;
        },
        async transform(code, id) {
            let map = null;
            // Prevent transforming of Ext.loader scripts
            if (id.includes(`?${disableCachingParam}=`)) {
                Logger.info(`- Ignoring (Ext JS Loader): ${id}`);
                return { code, map };
            }
            const cleanId = (id.includes('?') && id.slice(0, id.indexOf('?'))) || id;
            if (Path.isIgnore(cleanId)) {
                Logger.info(`- Ignoring (always skip): ${id}`);
                return { code, map };
            }
            const mustInclude = entryPoints.length && entryPoints.some((pattern) => id.includes(pattern));
            if (!mustInclude) {
                if (!Path.isMatch(cleanId, searchPaths)) {
                    Logger.info(`- Ignoring (not mapped): ${id}`);
                    return { code, map };
                }
                if (Path.isMatch(id, exclude)) {
                    Logger.info(` - Skipping: ${id}`);
                    return { code, map };
                }
            }
            const fileMeta = ExtAnalyzer.sync(code, cleanId);
            if (fileMeta.isCached && fileMeta.transformedCode) {
                Logger.info(`- Ignoring (not changed): ${id}`);
                return { code: fileMeta.transformedCode, map };
            }

            Logger.info(`+ Analyzing: ${id}`);

            // TODO try magic-string
            code = fileMeta.applyCodeTransforms();
            if (fileMeta.transformedCode) {
                Logger.info(`+ ${pluralize(fileMeta.appliedTransformations, 'transformation')} applied.`);
            }
            const importPaths = fileMeta.getImportsPaths();
            const missingImports = fileMeta.getMissingImports(ignoredNamespaces);
            if (Object.values(missingImports).filter((imports) => imports.length).length) {
                const isFatal = resolvedConfig.command === 'build' && resolvedConfig.mode === 'production';
                Logger[isFatal ? 'fatal' : 'error'](`Missing imports for ${pathToFileURL(cleanId)}`, missingImports);
                if (!isFatal) {
                    Object.assign(globalMissingImports, missingImports);
                }
            }
            if (!importPaths.length) {
                Logger.info('- Empty import paths.');
                totalModules++;
                if (fileMeta.appliedTransformations) {
                    if (sourceMapIsEnabled) {
                        Logger.info('+ Generating new sourcemap.');
                        map = new MagicString(fileMeta.transformedCode).generateMap({ hires: true }).toString();
                    }
                }
                return { code, map };
            }
            let importString = '';
            for (const path of importPaths) {
                if (path === id) {
                    continue;
                }
                importString += `import '${path}';` + EOL;
            }
            if (importString.length) {
                fileMeta.transformedCode =
                    code = `/* <${PLUGIN_NAME}> */${EOL}${importString}/* </${PLUGIN_NAME}> */${EOL}${code}`;
                Logger.info(`+ ${pluralize(importPaths.length, 'import')} injected.`);
            }
            totalModules++;
            if (importString.length || fileMeta.appliedTransformations) {
                if (sourceMapIsEnabled) {
                    Logger.info('+ Generating new sourcemap.');
                    map = new MagicString(fileMeta.transformedCode).generateMap({ hires: true }).toString();
                }
            }
            return {
                code,
                map,
            };
        },
        transformIndexHtml() {
            const { basePath, outCssFile, outputDir = 'theme' } = theme;
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
        async handleHotUpdate(ctx) {
            const { file, server, modules } = ctx;
            let classes = [];
            const urls = [];
            // new module
            if (!modules.length) {
                const newMeta = await classMap.add(file);
                const newClasses = newMeta.getClassNames();
                if (newClasses.length) {
                    classes = classes.concat(newMeta.getClassNames());
                    urls.push(Path.relative(file));
                }
            }
            for (const module of modules) {
                if (module.url.includes('?_hmr=')) {
                    continue;
                }
                const meta = ExtAnalyzer.getFile(module.id);
                if (meta) {
                    urls.push(module.url + '?_hmr=' + module.lastInvalidationTimestamp);
                    classes = classes.concat(meta.getClassNames());
                }
            }
            if (urls.length) {
                server.ws.send({
                    type: 'custom',
                    event: 'module-update',
                    data: { urls, classes },
                });
            } else {
                server.ws.send({
                    type: 'full-reload',
                });
            }
            return [];
        },
        configureServer(server) {
            Logger.info('Server is configured.');
            server.watcher.on('add', async (id) => {
                const cleanId = (id.includes('?') && id.slice(0, id.indexOf('?'))) || id;
                if (Path.isMatch(cleanId, searchPaths)) {
                    console.clear();
                    Logger.warn(`Restarting server due to new file: ${id}`);
                    skipThemeBuild = true;
                    server.restart();
                }
            });
        },
    };
};

export default viteExtJS;
