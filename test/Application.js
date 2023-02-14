import {Ext} from "./Ext.js";

Ext.define('Some.ext.Module', {
    extend: 'Some.other.BaseModule',
    requires:['Some.*'],
});