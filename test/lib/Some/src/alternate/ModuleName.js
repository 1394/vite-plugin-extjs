Ext.define('Some.alternate.ModuleName', {
    extend: 'Ext.panel.Panel',
    alternateClassName: [
        'SigmaUtilities.view.common.component.ForeignSelectWindow'
    ],
    requires: [],
    uses: [],
    constructor() {
        console.log('ModuleName');
    }
});
