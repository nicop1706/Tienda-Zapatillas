const path = require('path');
// dotenv no sobrescribe variables ya definidas (útil para las pruebas)
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'tienda_zapatillas',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  charset: 'utf8mb4',
  dateStrings: true,     // DATETIME llega como texto 'YYYY-MM-DD HH:MM:SS' (sin conversiones de zona horaria)
  decimalNumbers: true,  // DECIMAL llega como número JS
});

/** Comprueba la conexión (SELECT 1). Lanza el error original si falla. */
async function ping() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

async function close() {
  await pool.end();
}

module.exports = { pool, ping, close };
