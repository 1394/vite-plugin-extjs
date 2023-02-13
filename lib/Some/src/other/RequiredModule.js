import {Ext} from "/src/Ext.js";

Ext.define('Some.other.RequiredModule', {
    extend: 'Ext.panel.Panel',
    requires: [],
    uses: [],
    constructor() {
        console.log('RequiredModule');
    }
});