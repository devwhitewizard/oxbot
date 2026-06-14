const mysql = require('mysql2/promise');

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
