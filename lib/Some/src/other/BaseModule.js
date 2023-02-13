import '/lib/Some/src/other/RequiredModule.js';
import '/lib/Some/src/more/DependentModule.js';
import {Ext} from "/src/Ext.js";

Ext.define('Some.other.BaseModule', {
    extend: 'Some.more.DependentModule',
    requires: ['Some.other.RequiredModule'],
    uses: [],
    constructor() {
        console.log('BaseModule');
    }
});