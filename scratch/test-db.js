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
        const [users] = await db.query('SELECT id, name, username, email, phone FROM users ORDER BY id DESC LIMIT 10');
        console.log('--- USERS ---');
        console.log(users);

        const [logs] = await db.query('SELECT * FROM console_logs ORDER BY id DESC LIMIT 20');
        console.log('--- CONSOLE LOGS ---');
        console.log(logs);

        const [sessions] = await db.query('SELECT * FROM paired_sessions ORDER BY id DESC LIMIT 5');
        console.log('--- PAIRED SESSIONS ---');
        console.log(sessions);
    } catch (err) {
        console.error(err);
    } finally {
        await db.end();
    }
})();
