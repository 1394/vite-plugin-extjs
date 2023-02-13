import {walk} from 'estree-walker';
import fg from 'fast-glob';

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

const importExt = (mappings) => ({
    name: 'vite-import-ext',
    async transform(code, id) {
        let ast;
        const extend = [];
        const uses = [];
        const requires = [];
        const resolved = [];
        if (id.endsWith('.js')) {
            ast = this.parse(code);
            walk(ast, {
                enter: node => {
                    if (node.type === 'ExpressionStatement') {
                        if (node.expression.callee.object.name === 'Ext') {
                            // Ext.define
                            if (node.expression.callee.property.name === 'define') {
                                const props = node.expression.arguments[1].properties;
                                props.forEach(prop => {
                                    // extend
                                    if (prop.key.name === 'extend') {
                                        extend.push(prop.value.value);
                                    }
                                    // uses, requires
                                    if (['uses', 'requires'].includes(prop.key.name)) {
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
            for (const module of imports) {
                const paths = await resolve(mappings, module);
                paths.forEach(path => {
                    path && resolved.push(path);
                });
            }
        }
        for (const resolvedPath of resolved) {
            if (resolvedPath) {
                code = `import '${resolvedPath}.js';\n`.concat(code);
            }
        }
        return {code, ast, map: null};
    },
})
export default {
    plugins: [
        importExt({Some: '/lib/Some/src'})
    ]
}