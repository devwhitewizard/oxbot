const { Browsers } = require('@whiskeysockets/baileys');

console.log('ubuntu Chrome:', Browsers.ubuntu('Chrome'));
console.log('macOS Chrome:', Browsers.macOS('Chrome'));
console.log('macOS Desktop:', Browsers.macOS('Desktop'));
console.log('baileys version:', require('@whiskeysockets/baileys/package.json').version);
