Ext.define('Some.other.OverrideModule', {
    override: 'Ext.panel.Panel',
    requires: [],
    uses: [],
    constructor() {
        this.callParent();
    },
});
