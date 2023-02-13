import {Ext} from "/src/Ext.js";

Ext.define('Some.another.UseModule', {
    extend: 'Ext.panel.Panel',
    requires: [],
    uses: [],
    constructor() {
        console.log('UseModule');
    }
});