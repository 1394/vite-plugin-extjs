Ext.define('Some.more.DependentModule', {
    extend: 'Ext.panel.Panel',
    requires: [],
    uses: [],
    constructor() {
        console.log('DependentModule');
    }
});