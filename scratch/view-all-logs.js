const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const db = mysql.createPool({
        host:             process.env.DB_HOST !== undefined ? process.env.DB_HOST : 'localhost',
        user:             process.env.DB_USER !== undefined ? process.env.DB_USER : 'zestpayn_dominion',
        password:         process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'Dorc@s12345#',
        database:         process.env.DB_DATABASE !== undefined ? process.env.DB_DATABASE : 'zestpayn_nodeapp9',
    });

    try {
        const [logs] = await db.query('SELECT * FROM console_logs WHERE user_id = 1 ORDER BY id DESC LIMIT 100');
        console.log('--- CONSOLE LOGS ---');
        logs.reverse().forEach(log => {
            console.log(`[${log.time}] (${log.id}) ${log.message}`);
        });
    } catch (err) {
        console.error(err);
    } finally {
        await db.end();
    }
})();
