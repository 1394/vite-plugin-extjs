Ext.define('Some.other.BaseModule', {
    extend: 'Some.more.DependentModule',
    requires: ['Some.other.RequiredModule'],
    uses: [],
    constructor() {
        console.log('BaseModule constructor');
        this.callParent();
    }
});