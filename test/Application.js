Ext.define('Some.multiple.defined.Module', {
    extend: 'Some.other.RequiredModule',
    multipleFn() {
        this.callParent();
    }
});
Ext.define('Some.Application', {
    extend: 'Some.other.BaseModule',
    alias: 'widget.module',
    requires: [],
    test01: function () {
        this.callParent();
    },
    test02: function () {
        this.callParent(arguments);
    },
    test03: function (arg) {
        this.callParent([arg]);
    },
    test04: function (arg) {
        const variable = {arg};
        this.callParent([variable]);
    },
    test05: function (arg) {
        this.callParent([{}, arg]);
    },
    test06: function (arg) {
        this.callParent(arguments);
    },
    test07: function (arg, arg1) {
        this.callParent([arg]);
    },
    test08: function (arg, arg1) {
        this.callParent([arg, arg1]);
    },
    test09: function () {
        const variable = this.callParent();
    },
    test10: function () {
        const variable = this.callParent(arguments);
    },
    test11: function (arg) {
        /*
         * Possible error, because the argument may not be an array
         * @Coon.common.component.editor.CharacteristicLoaderPlugin
         */
        this.callParent(arg);
    },
    test12: function () {
        /*
         * Possible error, because the arguments is array already
         * @Coon.report.column.DynamicActionColumn
         */
        return this.callParent([arguments]);
    },
    test13: function (...args) {
        this.callParent(...args);
    },
    test14: function () {
        const me = this;
        me.callParent();
    },
    test15: function (arg) {
        const me = arg;
        /*TODO check if me === this*/
        me.callParent();
    },
});
