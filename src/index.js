import {simple} from 'acorn-walk';
import fg from 'fast-glob';
import nodePath from 'node:path';

const PLUGIN_NAME = 'vite-plugin-extjs';

async function resolve(mappings, className) {
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

const viteImportExtjsRequires = (mappings, options = {replaceCallParent: true}) => {
    let MODE;
    return {
        name: PLUGIN_NAME,
        config(config, {mode}) {
            MODE = mode;
        },
        async transform(code, id) {
            if (!mappings || id.endsWith('.css') || id.endsWith('.html')) {
                return;
            }
            // Check if is Vite file
            if (id.includes('node_modules/.vite')) {
                return;
            }
            let ast;
            const extend = [];
            const uses = [];
            const requires = [];
            ast = this.parse(code);
            const existingImports = [];
            let callParentNodes;
            simple(ast, {
                ImportDeclaration(node) {
                    existingImports.push(realpath(node.source.value));
                },
                ExpressionStatement: (node) => {
                    if (node.expression.callee?.object?.name === 'Ext') {
                        // Ext.define
                        if (node.expression.callee.property.name === 'define') {
                            const props = node.expression.arguments[1].properties;
                            props?.forEach(prop => {
                                // extend, override
                                if (['extend', 'override'].includes(prop.key.name)) {
                                    extend.push(prop.value.value);
                                    if (options.replaceCallParent === true) {
                                        callParentNodes = findCallParent(code, node, prop.value.value, prop.key.name === 'override');
                                    }
                                }
                                // uses, requires, override, mixins
                                if (['uses', 'requires', 'override', 'mixins'].includes(prop.key.name)) {
                                    if (prop.value.type === 'ArrayExpression') {
                                        prop.value.elements.forEach(el => {
                                            uses.push(el.value);
                                        });
                                    } else if (prop.value.type === 'Literal') {
                                        uses.push(prop.value.value);
                                    }
                                }
                            });
                        }
                    }
                },
            });
            const imports = [...extend, ...uses, ...requires];
            let importStr = '';
            for (const module of imports) {
                const paths = await resolve(mappings, module);
                for (const path of paths) {
                    if (path) {
                        const realPath = realpath(path);
                        if (!existingImports.includes(realPath) && !existingImports.includes(`${realPath}.js`)) {
                            importStr += `import '${path}.js';\n`;
                            existingImports.push(realPath);
                        }
                    }
                }

            }
            let originalCode = code;
            if (options.replaceCallParent === true && callParentNodes && callParentNodes.length) {
                callParentNodes.reverse().forEach(({node, replacement}) => {
                    code = replaceCode(code, node, replacement);
                });
            }
            if (importStr.length) {
                code = `/*** <${PLUGIN_NAME}> ***/\n${importStr}/*** </${PLUGIN_NAME}> ***/\n\n${code}`;
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
