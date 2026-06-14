const fs = require('fs');
const lines = fs.readFileSync('c:/Users/Admin/Desktop/bots-collection/oxbot/app.js', 'utf8').split('\n');
lines.forEach((line, index) => {
    if (line.includes('handleIncomingMessage')) {
        console.log(`${index + 1}: ${line}`);
    }
});
