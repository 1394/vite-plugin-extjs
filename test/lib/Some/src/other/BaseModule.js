Ext.define('Some.other.BaseModule', {
    extend: 'Some.more.DependentModule',
    controller: 'basemodulecontroller',
    viewModel: {
        type: 'basemoduleviewmodel',
    },
    requires: ['Some.other.RequiredModule'],
    uses: [],
    constructor() {
        console.log('BaseModule constructor');
        this.callParent();
    },
});
