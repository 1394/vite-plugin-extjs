Ext.define('Some.another.UseModule', {
    xtype: 'UseModule',
    extend: 'Ext.panel.Panel',
    requires: [],
    uses: [],
    viewModel: 'usemoduleviewmodel',
    constructor() {
        console.log('UseModule');
        this.callParent();
    },
});
