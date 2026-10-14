const mysql = require('mysql2');
require('dotenv').config();

// A connection pool (instead of a single connection) keeps the app working
// even if MySQL closes an idle connection.
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    // Return DATE/DATETIME columns as plain strings (e.g. "2026-10-14")
    dateStrings: true
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }

    console.log('MySQL database connected successfully!');
    connection.release();
});

module.exports = db;
