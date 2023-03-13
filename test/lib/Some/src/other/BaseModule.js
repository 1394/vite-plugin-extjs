Ext.define('Some.other.BaseModule', {
    extend: 'Ext.panel',
    controller: 'basemodulecontroller',
    viewModel: {
        type: 'basemoduleviewmodel',
    },
    uses: [],
    constructor() {
        console.log('BaseModule constructor');
        this.callParent();
    },
});
