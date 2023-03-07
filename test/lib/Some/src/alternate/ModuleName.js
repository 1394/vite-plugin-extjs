Ext.define('Some.alternate.ModuleName', {
    alias: 'widget.ModuleName',
    extend: 'Ext.panel.Panel',
    alternateClassName: [
        'SigmaUtilities.view.common.component.ForeignSelectWindow'
    ],
    requires: [],
    uses: [],
    constructor() {
        console.log('alternate.ModuleName');
    }
});
