import {Ext} from "/test/Ext.js";

Ext.define('Some.other.OverrideModule', {
    override: 'Ext.panel.Panel',
    requires: [],
    uses: [],
    constructor() {
        console.log('OverrideModule');
    }
});