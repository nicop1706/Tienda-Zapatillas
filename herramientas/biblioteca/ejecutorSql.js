const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const RAIZ = path.join(__dirname, '../..');

/** Conexión administrativa (sin base seleccionada) para crear/borrar bases y ejecutar scripts. */
async function conexionAdmin() {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_ADMIN_USER || 'root',
    password: process.env.DB_ADMIN_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });
}

/** Lee un .sql de /database sustituyendo el nombre de la base por `nombreBd`. */
function leerSql(archivo, nombreBd) {
  const sql = fs.readFileSync(path.join(RAIZ, 'base_de_datos', archivo), 'utf8');
  return sql.replace(/\btienda_zapatillas\b/g, nombreBd);
}

module.exports = { conexionAdmin, leerSql, RAIZ };
