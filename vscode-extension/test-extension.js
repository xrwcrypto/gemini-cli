// Test if the extension exports are correct
const ext = require('./dist/extension.js');
console.log('Extension exports:', Object.keys(ext));
console.log('activate function:', typeof ext.activate);
console.log('deactivate function:', typeof ext.deactivate);