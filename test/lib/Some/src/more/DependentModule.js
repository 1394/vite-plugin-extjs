import {Ext} from "/test/Ext.js";

Ext.define('Some.more.DependentModule', {
    extend: 'Ext.panel.Panel',
    requires: [],
    uses: [],
    constructor() {
        console.log('DependentModule');
    }
});