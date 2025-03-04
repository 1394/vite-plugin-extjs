import { copy, ensureFile, remove } from 'fs-extra/esm';
import { createReadStream, createWriteStream } from 'node:fs';
import readline from 'node:readline/promises';
import { EOL } from 'node:os';
import { readFile } from 'node:fs/promises';
import { Path } from './Path.js';
import { Logger } from './Logger.js';
import { fork } from 'node:child_process';

export class Theme {
    static defaultCssFileName = 'theme.css';

    static async transform(
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
            if (typeof replaceImportPaths === 'object') {
                if (replaceImportPaths.search && replaceImportPaths.replace) {
                    line = line.replace(replaceImportPaths.search, replaceImportPaths.replace);
                } else {
                    // key-value format
                    for (const search in replaceImportPaths) {
                        line = line.replace(search, replaceImportPaths[search]);
                    }
                }
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

    static async build(theme, resolvedConfig, assetsMap = []) {
        if (!theme || (typeof theme === 'object' && !Object.keys(theme).length)) {
            return false;
        }
        Logger.warn('[Theme] Build start.');
        let assetsBundleSource = '';
        for (const path of assetsMap) {
            assetsBundleSource += `/* ${path} */${EOL}` + (await readFile(path)).toString() + EOL;
        }
        const {
            basePath,
            sassPath = 'sass',
            sassFile,
            outCssFile,
            outputDir = 'theme',
            setSassVars,
            replaceImportPaths,
            addImports,
            imageSearchPath,
        } = theme;
        if (basePath) {
            const themeBundle = Path.resolve([basePath, sassPath, '_bundle.scss'].filter(Boolean).join('/'));
            try {
                const sassFilePath = Path.resolve([basePath, sassPath, sassFile].filter(Boolean).join('/'));
                // Transform theme sass file
                await this.transform(themeBundle, sassFilePath, {
                    setSassVars,
                    replaceImportPaths,
                    addImports,
                    assetsBundleSource,
                    imageSearchPath: Path.resolve(imageSearchPath || basePath),
                });
                const outCssFilePath = Path.resolve(basePath + '/' + (outCssFile || this.defaultCssFileName));
                Logger.warn('[Fashion] Compiling sass to css...');
                // Run fashion-cli
                const code = await this.compile(outCssFilePath, themeBundle);
                Logger.warn('[Fashion] Finished with exit code ' + code + '.');
                // Copying theme to outputDir
                if (resolvedConfig.command === 'build' && resolvedConfig.mode === 'production') {
                    const themeDestDir = Path.resolve(
                        [resolvedConfig.build.outDir, outputDir].filter(Boolean).join('/')
                    );
                    Logger.warn('Copying compiled theme files...');
                    await copy(Path.resolve(basePath), themeDestDir, { overwrite: true });
                }
                Logger.warn('[Theme] Build end.');
                return true;
            } catch (e) {
                console.error(e);
                process.exit(1);
            }
        }
        return false;
    }

    static compile(outCssFilePath, themeBundle) {
        return new Promise((resolve) => {
            const fashion = fork(Path.resolve('/node_modules/fashion-cli/fashion.js'), [
                'compile',
                themeBundle,
                outCssFilePath,
            ]);
            fashion.on('exit', (code) => {
                resolve(code);
            });
        });
    }
}
