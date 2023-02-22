import {simple} from 'acorn-walk';
import fg from 'fast-glob';
import nodePath from 'node:path';

const PLUGIN_NAME = 'vite-plugin-extjs';

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
                    } else {
                        include = false;
                    }
                }
                include && classMeta.imports.push(path);
            }
        }
    }
}

/**
 * @param {object} mappings
 * @param {string} className
 * @param {string} requiredBy
 * @param {object} classAlternateNames
 */
async function resolve(mappings, className, requiredBy, classAlternateNames = {}) {
    const classParts = className.split('.');
    const namespace = classParts.shift();
    let path;
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
    }
    if(!path){
        console.log('\x1b[33m%s\x1b[0m', `[${PLUGIN_NAME}] '${namespace}' namespace is not mapped. [${requiredBy} requires ${className}]`);
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
        return this.imports.reduce((str, path) => `${str}import '${path}.js';\n`, '');
    }
}

const viteImportExtjsRequires = (mappings, options = {replaceCallParent: true}) => {
    let MODE;
    let ENTRY;
    const classMap = new Map();
    const classAlternateNames = {};
    const importsMap = [];
    return {
        name: PLUGIN_NAME,
        config(config, {mode}) {
            MODE = mode;
            // TODO check mappings - error if path is not exists
        },
        async transform(code, id) {
            typeof ENTRY === 'undefined' && (ENTRY = id);
            if (!mappings || id.endsWith('.css') || id.endsWith('.html') || id.endsWith('?direct')) {
                return;
            }
            // Check if is Vite file
            if (id.includes('node_modules/.vite') || id.includes('vite@')) {
                return;
            }
            const ast = this.parse(code);
            let callParentNodes = [];
            const definedClasses = [];
            simple(ast, {
                ImportDeclaration(node) {
                    importsMap.push(realpath(node.source.value));
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
                                    if (options.replaceCallParent === true) {
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
            if (options.replaceCallParent === true && callParentNodes.length) {
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
                await resolveClassImports(mappings, definedClass, importsMap, classAlternateNames);
                if (definedClass.imports.length) {
                    importString += `${definedClass.getImportString()}`;
                }
            }
            if (importString.length) {
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
