Ext.define('Some.more.DependentModule', {
    extend: 'SigmaUtilities.view.common.component.ForeignSelectWindow',
    constructor() {
        console.log('DependentModule');
    }
});
