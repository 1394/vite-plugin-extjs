import './RequiredModule.js';
import '../more/DependentModule.js';
import {Ext} from "/test/Ext.js";

Ext.define('Some.other.BaseModule', {
    extend: 'Some.more.DependentModule',
    requires: ['Some.other.RequiredModule'],
    uses: [],
    constructor() {
        console.log('BaseModule');
    }
});