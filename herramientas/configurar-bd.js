/**
 * Crea la base de datos y las tablas (esquema.sql) y, opcionalmente, carga los datos ficticios (datos-ejemplo.sql).
 *
 *   npm run db:setup              -> solo esquema (no borra datos existentes)
 *   npm run db:setup -- --seed    -> esquema + datos de prueba (solo si la tabla productos está vacía)
 *   npm run db:setup -- --reset   -> BORRA la base y la recrea con datos de prueba
 *
 * Usa DB_ADMIN_USER / DB_ADMIN_PASSWORD del archivo .env para las tareas administrativas y
 * concede permisos al usuario de la aplicación (DB_USER) sobre la base.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { conexionAdmin, leerSql } = require('./biblioteca/ejecutorSql');

/**
 * Migra bases creadas con versiones anteriores del esquema (sin borrar datos):
 *  - productos.descripcion
 *  - ventas.subtotal / ventas.igv (las ventas antiguas se tratan como total con IGV incluido 18 %)
 */
async function migrar(conn, bd) {
  const existe = async (tabla, columna) => {
    const [r] = await conn.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [bd, tabla, columna]);
    return r.length > 0;
  };
  if (!(await existe('productos', 'descripcion'))) {
    await conn.query(`ALTER TABLE \`${bd}\`.productos ADD COLUMN descripcion VARCHAR(255) NULL AFTER categoria`);
    console.log('Migración: añadida productos.descripcion');
  }
  if (!(await existe('ventas', 'subtotal'))) {
    await conn.query(`ALTER TABLE \`${bd}\`.ventas
      ADD COLUMN subtotal DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER estado,
      ADD COLUMN igv DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER subtotal`);
    // En versiones anteriores total era la suma de líneas (sin IGV): se conserva como subtotal.
    await conn.query(`UPDATE \`${bd}\`.ventas SET subtotal = total, igv = ROUND(total * 0.18, 2), total = ROUND(total * 1.18, 2)`);
    console.log('Migración: añadidos ventas.subtotal e ventas.igv (IGV 18 %)');
  }
}

(async () => {
  const args = new Set(process.argv.slice(2));
  const nombreBd = process.env.DB_NAME || 'tienda_zapatillas';
  if (!/^[A-Za-z0-9_]+$/.test(nombreBd)) throw new Error('DB_NAME contiene caracteres no permitidos.');

  const conn = await conexionAdmin();
  try {
    if (args.has('--reset')) {
      console.log(`Eliminando la base «${nombreBd}»...`);
      await conn.query(`DROP DATABASE IF EXISTS \`${nombreBd}\``);
    }
    console.log('Creando esquema...');
    await conn.query(leerSql('esquema.sql', nombreBd));
    await migrar(conn, nombreBd);

    if (args.has('--seed') || args.has('--reset')) {
      const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${nombreBd}\`.productos`);
      if (n > 0) {
        console.log('La tabla productos ya tiene datos: se omite datos-ejemplo.sql (usa --reset para recrear).');
      } else {
        console.log('Cargando datos ficticios (datos-ejemplo.sql)...');
        await conn.query(leerSql('datos-ejemplo.sql', nombreBd));
      }
    }

    // Permisos para el usuario de la aplicación (si es distinto del administrador)
    const usuario = process.env.DB_USER;
    if (usuario && usuario !== (process.env.DB_ADMIN_USER || 'root')) {
      const clave = process.env.DB_PASSWORD || '';
      await conn.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [usuario, 'localhost', clave]);
      // Si el usuario ya existía con otra clave, se alinea con DB_PASSWORD del .env
      await conn.query('ALTER USER ?@? IDENTIFIED BY ?', [usuario, 'localhost', clave]);
      await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${nombreBd}\`.* TO ?@?`, [usuario, 'localhost']);
      await conn.query('FLUSH PRIVILEGES');
      console.log(`Permisos concedidos a ${usuario}@localhost sobre ${nombreBd}.`);
    }
    console.log('Listo.');
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Error en la configuración de la base de datos:', err.message);
  process.exit(1);
});
