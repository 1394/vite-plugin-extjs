import {simple} from 'acorn-walk';
import fg from 'fast-glob';
import nodePath from 'node:path';
import {accessSync, constants} from 'node:fs';
import pc from 'picocolors';

const PLUGIN_NAME = 'vite-plugin-extjs';
let DEBUG = false;
let MODE;

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

function getSource(code, node) {
    return code.slice(node.start, node.end);
}

function argsToStr(code, args = []) {
    return args.reduce((_, cur) => getSource(code, cur), '');
}

function propToArray({type, elements, value}) {
    const result = [];
    if (type === 'ArrayExpression') {
        elements.forEach(el => {
            result.push(el.value);
        });
    } else if (type === 'Literal') {
        result.push(value);
    }
    return result;
}

const replaceCallParentDirect = (className, fnName, scope, args, isOverride) => {
    const argStr = args.length ? `${scope}, ${args}` : scope;
    let fn = `(${className}.prototype || ${className})['${fnName}']`;
    if (isOverride) {
        fn = `(${fn}['$previous'] || ${fn})`;
    }
    return `${fn}.apply(${argStr})`;
}

const replaceCallParentSuper = (className, fnName, scope, args) => {
    const argStr = args.length ? `, ${args}` : '';
    return `${scope}.super(${scope}, '${fnName}'${argStr})`;
}

function findCallParent(code, node, className, isOverride) {
    const matches = [];
    simple(node, {
        Property: (prop) => {
            if (prop.value?.type === 'FunctionExpression') {
                const fnName = prop.key.name;
                simple(prop, {
                    FunctionExpression: (fnBody) => {
                        simple(fnBody, {
                            CallExpression(node) {
                                if (node.callee?.property?.name === 'callParent') {
                                    const replacement = replaceCallParentDirect(
                                        className,
                                        fnName,
                                        getSource(code, node.callee.object),
                                        argsToStr(code, node.arguments),
                                        isOverride
                                    );
                                    //TODO push only start & end
                                    matches.push({node, replacement});
                                }
                            }
                        });
                    }
                });
            }
        }
    });
    return matches;
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

function isInMappings(id, mappings = {}) {
    return Object.values(mappings).filter(Boolean).some(path => id.includes(path))
}

function shouldSkip(id, mappings = {}, exclude = []) {
    const checks = [
        exclude.some(pattern => new RegExp(pattern).test(id)),
        id.endsWith('.css'),
        id.endsWith('.scss'),
        id.endsWith('.html'),
        id.endsWith('?direct'),
        id.includes('node_modules/.vite'),
        id.includes('vite@'),
    ];
    return checks.some(Boolean);
}

class ExtClassProps {
    name = '';
    alias = '';
    extend;
    override;
    alternateNames = [];
    requires = [];
    uses = [];
    mixins = [];
    imports = [];
}

class ExtClassMeta extends ExtClassProps {
    constructor() {
        super();
        Object.assign(this, ...arguments);
    }

    getImportString() {
        return this.imports.reduce((str, path) => `${str}import '${path}${path.endsWith('.scss') ? '' : '.js'}';\n`, '');
    }
}

class ExtFileMeta {
    definedClasses = [];
    callParentNodes = [];
    existingImports = [];
}

const viteImportExtjsRequires = (
    {
        mappings = {},
        replaceCallParent = true,
        debug = false,
        exclude = [],
        include = [],
    }) => {
    DEBUG = typeof debug === 'object' ? (Object.keys(debug).length && debug) || false : debug;
    const isDefinedMappings = typeof mappings === 'object' && Object.values(mappings).length > 0;
    const classMap = new Map();
    const classAlternateNames = {};
    return {
        name: PLUGIN_NAME,
        config(config, {mode}) {
            MODE = mode;
            // TODO check mappings - error if path is not exists
        },
        async transform(code, id) {
            if (!isDefinedMappings) {
                warn(`No mappings defined.`);
                return;
            }
            const mustInclude = include.length && include.some(pattern => id.includes(pattern));
            if (!mustInclude) {
                if (!isInMappings(id, mappings)) {
                    warn(`Path is not mapped: [${id}]`);
                    return;
                }
                if (shouldSkip(id, mappings, exclude)) {
                    warn(`skipping: ${id}`);
                    return;
                }
            }
            log(`analyzing: ${id}`);
            const ast = this.parse(code);
            const existingImports = [];
            let callParentNodes = [];
            const definedClasses = [];
            simple(ast, {
                ImportDeclaration(node) {
                    existingImports.push(realpath(node.source.value));
                },
                ExpressionStatement: (node) => {
                    if (node.expression.callee?.object?.name === 'Ext') {
                        // Ext.define
                        if (node.expression.callee.property.name === 'define') {
                            const extClassMeta = new ExtClassMeta({name: node.expression.arguments[0].value})
                            definedClasses.push(extClassMeta);
                            const props = node.expression.arguments[1].properties;
                            props?.forEach(prop => {
                                // alias
                                if (prop.key.name === 'alias') {
                                    extClassMeta.alias = prop.value.value;
                                }
                                // alternateClassName
                                if (prop.key.name === 'alternateClassName') {
                                    extClassMeta.alternateNames = propToArray(prop.value);
                                }
                                // extend, override
                                if (['extend', 'override'].includes(prop.key.name)) {
                                    extClassMeta[prop.key.name] = prop.value.value;
                                    if (replaceCallParent === true) {
                                        callParentNodes = callParentNodes.concat(findCallParent(code, node, prop.value.value, prop.key.name === 'override'));
                                    }
                                }
                                // uses, requires, mixins
                                if (['uses', 'requires', 'mixins'].includes(prop.key.name)) {
                                    // TODO mixins can be object
                                    extClassMeta[prop.key.name] = propToArray(prop.value);
                                }
                            });
                        }
                    }
                },
            });
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
                classMap.set(definedClass.name, definedClass);
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
                console.log(importString);
                code = `/*** <${PLUGIN_NAME}> ***/\n${importString}/*** </${PLUGIN_NAME}> ***/\n\n${code}`;
            }
            if (MODE === 'production') {
                return {code};
            }
            const isChangedCode = (originalCode === code);
            return {code, ast: isChangedCode ? undefined : ast};
        },
    };
}
export {viteImportExtjsRequires}
