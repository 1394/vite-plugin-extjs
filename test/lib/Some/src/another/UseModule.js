Ext.define('Some.another.UseModule', {
    xtype: 'UseModule',
    extend: 'Ext.panel.Panel',
    requires: [],
    uses: [],
    constructor() {
        console.log('UseModule');
    }
});
