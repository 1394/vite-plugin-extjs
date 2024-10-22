import pc from 'picocolors';

export class Logger {
    static #config = {};
    static addNewLine = false;
    static #prefix = '';
    static get prefix() {
        return this.#prefix && this.#prefix.length ? `[${this.#prefix}] ` : '';
    }

    static set prefix(prefix) {
        this.#prefix = prefix;
    }

    static set config(config) {
        this.#config = typeof config === 'object' ? (Object.keys(config).length && config) || false : config;
    }

    static get config() {
        return this.#config;
    }

    static skip(level) {
        return (typeof this.config === 'boolean' && !this.config) || (this.config !== true && !this.config[level]);
    }

    static echo(msg, level, ...rest) {
        if (this.skip(level) && level !== 'fatal') {
            return;
        }
        (this.addNewLine || level === 'fatal') && console.log();
        let color;
        switch (level) {
            case 'warn':
                color = pc.yellow;
                break;
            case 'info':
                color = pc.cyan;
                break;
            case 'fatal':
            case 'error':
                color = pc.red;
                break;
            default:
                color = pc.black;
        }
        console.log(`${color(this.prefix)}${msg}`, ...rest);
    }

    static warn(msg, ...rest) {
        this.echo(msg, 'warn', ...rest);
    }

    static info(msg, ...rest) {
        this.echo(msg, 'info', ...rest);
    }

    static error(msg, ...rest) {
        this.echo(msg, 'error', ...rest);
    }

    static fatal(msg, ...rest) {
        this.echo(msg, 'fatal', ...rest);
        process.exit(1);
    }
}
