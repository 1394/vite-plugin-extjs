import {walk} from 'estree-walker';
import fg from 'fast-glob';
import nodePath from "node:path";
import {open} from 'node:fs/promises';

const PLUGIN_NAME = 'vite-import-ext';

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

export default (mappings) => {
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
            let ast;
            const extend = [];
            const uses = [];
            const requires = [];
            ast = this.parse(code);
            const existingImports = [];
            walk(ast, {
                enter: async node => {
                    if (node.type === 'ImportDeclaration') {
                        existingImports.push(realpath(node.source.value));
                    }
                    if (node.type === 'ExpressionStatement') {
                        if (node.expression.callee?.object?.name === 'Ext') {
                            // Ext.define
                            if (node.expression.callee.property.name === 'define') {
                                const props = node.expression.arguments[1].properties;
                                props?.forEach(prop => {
                                    // extend
                                    if (prop.key.name === 'extend') {
                                        extend.push(prop.value.value);
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
                    }
                }
            })
            const imports = [...extend, ...uses, ...requires];
            let importStr = '';
            for (const module of imports) {
                const paths = await resolve(mappings, module);
                for (const path of paths) {
                    if (path) {
                        const realPath = realpath(path);
                        if (!existingImports.includes(realPath) && !existingImports.includes(`${realPath}.js`)) {
                            if (MODE === 'production') {
                                const file = await open(`${realPath}.js`);
                                const content = await file.readFile({encoding: 'utf8'});
                                file.close();
                                importStr += `${content}\n`;
                            } else {
                                importStr += `import '${path}.js';\n`;
                            }
                            existingImports.push(realPath);
                        }
                    }
                }

            }
            if (importStr.length) {
                code = `/*** <${PLUGIN_NAME}> ***/\n${importStr}/*** </${PLUGIN_NAME}> ***/\n\n${code}`;
            }
            return {code, ast, map: importStr.length ? true : undefined};
        },
    }
}
