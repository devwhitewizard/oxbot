/**
 * @file oxbot/database.js
 * @description Initializes and configures the MySQL database connection pool using mysql2/promise.
 * 
 * HOW IT WORKS:
 * - Creates a connection pool using host, user, password, and database variables from process.env or fallback values.
 * - Connection pool allows multiple queries to run concurrently, automatically queuing requests if limits are exceeded.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Imported by app.js during startup to run table migrations and setup.
 * - Imported by oxbot/utils.js, oxbot/botManager.js, oxbot/pairing.js, oxbot/middleware.js.
 * - Imported by all route modules in routes/* to perform CRUD operations on users, bots, tickets, and transactions.
 */

const mysql = require('mysql2/promise');

// Configure and create connection pool
const db = mysql.createPool({
    host:             process.env.DB_HOST !== undefined ? process.env.DB_HOST : 'localhost',
    user:             process.env.DB_USER !== undefined ? process.env.DB_USER : 'zestpayn_dominion',
    password:         process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'Dorc@s12345#',
    database:         process.env.DB_DATABASE !== undefined ? process.env.DB_DATABASE : 'zestpayn_nodeapp9',
    waitForConnections: true,
    connectionLimit:  10,
    queueLimit:       0,
});

module.exports = db;

