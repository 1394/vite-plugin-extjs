import fg from 'fast-glob';
import nodePath from 'node:path';
import {access, readFile, constants} from 'node:fs/promises';
import pc from 'picocolors';
import {ExtAnalyzer} from 'extjs-code-analyzer'

const PLUGIN_NAME = 'vite-plugin-extjs';
let DEBUG = false;
let MODE;
let AUTO_IMPORT_SASS = false;
const classMap = {};

async function resolveClassImports(mappings, classMeta, importsMap, classAlternateNames) {
    const imports = [
        classMeta.extend,
        classMeta.override,
        ...classMeta.requires,
        ...classMeta.uses,
        ...classMeta.mixins
    ].filter(Boolean);

    for (const className of imports) {
        const paths = await resolve(mappings, className, classMeta.name, classAlternateNames);
        for (const path of paths) {
            if (path) {
                const realPath = realpath(path);
                let include = true;
                if (Array.isArray(importsMap)) {
                    if (!importsMap.includes(realPath) && !importsMap.includes(`${realPath}.js`)) {
                        importsMap.push(realPath);
                        log(`${classMeta.name} imports ${className}. PATH: ${path}`);
                    } else {
                        include = false;
                    }
                }
                if (include) {
                    classMeta.imports.push(path);
                    if (AUTO_IMPORT_SASS) {
                        try {
                            accessSync(`${realPath}.scss`, constants.R_OK);
                            classMeta.imports.push(`${path}.scss`);
                        } catch (err) {
                        }
                    }
                }

            }
        }
    }
}

async function resolve(mappings, className, requiredBy, classAlternateNames = {}) {
    const classParts = className.split('.');
    const namespace = classParts.shift();
    let path;
    if (mappings[namespace] === false) {
        return [];
    }
    if (typeof classAlternateNames === 'object') {
        let realClassName;
        for (const key in classAlternateNames) {
            if (key === className) {
                realClassName = classAlternateNames[key];
            }
        }
        if (realClassName) {
            return await resolve(mappings, realClassName, requiredBy, classAlternateNames);
        }
    }
    if (mappings[namespace]) {
        path = [mappings[namespace]].concat(classParts).join('/');
    }
    if (path && path.includes('*')) {
        const cwd = process.cwd().replace(/\\/g, '/');
        const realPath = (cwd + path.replace('*', '**/*.js'));
        const realPaths = await fg(realPath);
        path = realPaths.map(realPath => {
            realPath = realPath.replace(cwd, '');
            if (realPath.endsWith('.js')) {
                realPath = realPath.slice(0, -3);
            }
            return realPath;
        });
    }
    if (!path) {
        warn(`'${namespace}' namespace is not mapped. [${requiredBy} requires ${className}]`);
    }
    return Array.isArray(path) ? path : [path];
}

function realpath(path) {
    return nodePath.normalize(process.cwd() + '\\' + path).replace(/\\/g, '/');
}

function replaceCode(code, node, replacement = '') {
    let transformedCode = code.slice(0, node.start);
    transformedCode += replacement;
    transformedCode += code.slice(node.end);
    return transformedCode;
}

function warn(msg) {
    if ((typeof DEBUG === 'boolean' && !DEBUG) || (DEBUG !== true && !DEBUG.warn)) {
        return;
    }
    MODE === 'production' && console.log();
    console.log(`${pc.yellow(`[${PLUGIN_NAME}]`)} ${msg}`);
}

function log(msg) {
    if ((typeof DEBUG === 'boolean' && !DEBUG) || (DEBUG !== true && !DEBUG.log)) {
        return;
    }
    MODE === 'production' && console.log();
    console.log(`${pc.cyan(`[${PLUGIN_NAME}]`)} ${msg}`);
}

function error(msg, ...rest) {
    MODE === 'production' && console.log();
    console.log(`${pc.red(`[${PLUGIN_NAME}]`)} ${msg}`, ...rest);
}

function isInMappings(id, mappings = {}) {
    return Object.values(mappings).filter(Boolean).some(path => id.includes(path))
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
    const checks = [
        exclude.some(pattern => new RegExp(pattern).test(id)),
    ];
    return checks.some(Boolean);
}

const viteImportExtjsRequires = (
    {
        mappings = {},
        replaceCallParent = true,
        debug = false,
        exclude = [],
        include = [],
        autoImportSass = false
    }) => {
    DEBUG = typeof debug === 'object' ? (Object.keys(debug).length && debug) || false : debug;
    AUTO_IMPORT_SASS = autoImportSass;
    // const isDefinedMappings = typeof mappings === 'object' && Object.values(mappings).length > 0;
    // const classMap = new Map();
    // const classAlternateNames = {};
    return {
        name: PLUGIN_NAME,
        async config(config, {mode}) {
            MODE = mode;
            for (const namespace in mappings) {
                const basePath = mappings[namespace];
                if (basePath) {
                    log(`Resolving namespace "${namespace}"...`);
                    try {
                        const realPath = realpath(basePath);
                        await access(realPath, constants.R_OK);
                        log(`Resolved: ${realPath}`);
                        console.time(`[ExtAnalyzer] Analyzed "${namespace}" in`);
                        const paths = await fg(realPath + '/**/*.js');
                        for (const path of paths) {
                            if (!path.endsWith('.js')) {
                                continue
                            }
                            const mustInclude = include.length && include.some(pattern => path.includes(pattern));
                            if (!mustInclude) {
                                if (shouldSkip(path, exclude)) {
                                    warn(`Skipping: ${path}`);
                                    continue;
                                }
                            }
                            const source = await readFile(path);
                            ExtAnalyzer.analyze(source.toString(), path);
                        }
                        console.timeEnd(`[ExtAnalyzer] Analyzed "${namespace}" in`);
                    } catch (err) {
                        warn(err.message);
                        console.log(err.stack);
                    }
                }
            }
            //TODO resolve imports
            // console.log(ExtAnalyzer.classes.classMap);
        },
        async transform(code, id) {
            if (alwaysSkip(id)) {
                log(`Ignoring: ${id}`);
                return;
            }
            const mustInclude = include.length && include.some(pattern => id.includes(pattern));
            if (!mustInclude) {
                if (!isInMappings(id, mappings)) {
                    warn(`Path is not mapped: [${id}]`);
                    return;
                }
                if (shouldSkip(id, exclude)) {
                    warn(`Skipping: ${id}`);
                    return;
                }
            }
            log(`Analyzing: ${id}`);
            /*let ast;
            try {
                ast = ExtAnalyzer.analyze(code, id);
            } catch (e) {
                error(e.message, id);
                return;
            }
            if (!definedClasses.length) {
                return MODE === 'production' ? {code} : {code, ast};
            }
            let originalCode = code;
            if (replaceCallParent === true && callParentNodes.length) {
                callParentNodes.reverse().forEach(({node, replacement}) => {
                    code = replaceCode(code, node, replacement);
                });
            }
            let importString = '';
            for (const definedClass of definedClasses) {
                // classMap.set(definedClass.name, definedClass);
                if (definedClass.alternateNames.length) {
                    definedClass.alternateNames.forEach(name => {
                        classAlternateNames[name] = definedClass.name;
                    });
                }
                await resolveClassImports(mappings, definedClass, existingImports, classAlternateNames);
                if (definedClass.imports.length) {
                    importString += `${definedClass.getImportString()}`;
                }
            }
            if (importString.length) {
                code = `/!*** <${PLUGIN_NAME}> ***!/\n${importString}/!*** </${PLUGIN_NAME}> ***!/\n\n${code}`;
            }
            if (MODE === 'production') {
                return {code};
            }
            const isChangedCode = (originalCode === code);
            return {code, ast: isChangedCode ? undefined : ast};*/
        },
    };
}
export {viteImportExtjsRequires}
