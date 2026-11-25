const { pool } = require('../configuracion/baseDatos');
const { AppError } = require('../utilidades/errores');

const COLUMNAS_ORDEN = {
  id: 'p.id', sku: 'p.sku', nombre: 'p.nombre', marca: 'p.marca', categoria: 'p.categoria',
  talla: 'p.talla', precio: 'p.precio', stock: 'p.stock', creado_en: 'p.creado_en',
  vendidos: 'vendidos',
};

const CAMPOS = 'p.id, p.sku, p.nombre, p.marca, p.modelo, p.talla, p.categoria, p.descripcion, p.precio, p.stock, p.creado_en';
// Unidades vendidas (solo ventas completadas) calculadas en vivo; nunca se almacenan
const VENDIDOS = `(SELECT COALESCE(SUM(d.cantidad), 0) FROM detalle_ventas d
                   JOIN ventas v ON v.id = d.venta_id AND v.estado = 'completada'
                   WHERE d.producto_id = p.id) AS vendidos`;

const escaparLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

async function listar({ q, categoria, page, limit, offset, orden = 'id', direccion = 'asc', soloConStock = false }) {
  const columna = COLUMNAS_ORDEN[orden];
  if (!columna) throw new AppError(400, 'Columna de orden no válida.', 'PARAMETRO_INVALIDO');
  const dir = String(direccion).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const condiciones = [];
  const params = [];
  if (q) {
    condiciones.push('(p.nombre LIKE ? OR p.sku LIKE ?)');
    const patron = `%${escaparLike(q)}%`;
    params.push(patron, patron);
  }
  if (categoria) { condiciones.push('p.categoria = ?'); params.push(categoria); }
  if (soloConStock) condiciones.push('p.stock > 0');
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM productos p ${where}`, params);
  // LIMIT/OFFSET: enteros ya validados; se usa query() para que el driver los escape como números
  const [filas] = await pool.query(
    `SELECT ${CAMPOS}, ${VENDIDOS} FROM productos p ${where} ORDER BY ${columna} ${dir}, p.id ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  filas.forEach((f) => { f.vendidos = Number(f.vendidos); });
  return { filas, total, page, limit, paginas: Math.max(1, Math.ceil(total / limit)) };
}

async function obtener(id) {
  const [filas] = await pool.execute(`SELECT ${CAMPOS}, ${VENDIDOS} FROM productos p WHERE p.id = ?`, [id]);
  if (!filas.length) throw new AppError(404, 'El producto no existe.', 'PRODUCTO_NO_ENCONTRADO');
  filas[0].vendidos = Number(filas[0].vendidos);
  return filas[0];
}

function traducirDuplicado(err) {
  if (err && err.code === 'ER_DUP_ENTRY') {
    return new AppError(409, 'Ya existe un producto con ese SKU.', 'SKU_DUPLICADO', { sku: 'Este SKU ya está registrado.' });
  }
  return err;
}

async function crear(v) {
  try {
    const [r] = await pool.execute(
      `INSERT INTO productos (sku, nombre, marca, modelo, talla, categoria, descripcion, precio, stock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.sku, v.nombre, v.marca, v.modelo, v.talla, v.categoria, v.descripcion, v.precio, v.stock],
    );
    return obtener(r.insertId);
  } catch (err) {
    throw traducirDuplicado(err);
  }
}

async function actualizar(id, v) {
  try {
    const [r] = await pool.execute(
      `UPDATE productos SET sku = ?, nombre = ?, marca = ?, modelo = ?, talla = ?,
              categoria = ?, descripcion = ?, precio = ?, stock = ? WHERE id = ?`,
      [v.sku, v.nombre, v.marca, v.modelo, v.talla, v.categoria, v.descripcion, v.precio, v.stock, id],
    );
    if (r.affectedRows === 0) throw new AppError(404, 'El producto no existe.', 'PRODUCTO_NO_ENCONTRADO');
    return obtener(id);
  } catch (err) {
    throw traducirDuplicado(err);
  }
}

async function eliminar(id) {
  try {
    const [r] = await pool.execute('DELETE FROM productos WHERE id = ?', [id]);
    if (r.affectedRows === 0) throw new AppError(404, 'El producto no existe.', 'PRODUCTO_NO_ENCONTRADO');
  } catch (err) {
    if (err && err.code === 'ER_ROW_IS_REFERENCED_2') {
      throw new AppError(409, 'No se puede eliminar el producto porque tiene ventas registradas.', 'PRODUCTO_CON_VENTAS');
    }
    throw err;
  }
}


/** Categorías existentes con número de productos (para los chips de filtro). */
async function categorias() {
  const [filas] = await pool.query('SELECT categoria, COUNT(*) AS productos FROM productos GROUP BY categoria ORDER BY categoria');
  return filas.map((f) => ({ categoria: f.categoria, productos: Number(f.productos) }));
}

/** Productos con stock igual o menor al umbral (los más urgentes primero). */
async function stockBajo(umbral, limite = 20) {
  const [filas] = await pool.query(
    `SELECT id, sku, nombre, marca, stock FROM productos
     WHERE stock <= ? ORDER BY stock ASC, id ASC LIMIT ?`,
    [umbral, limite],
  );
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM productos WHERE stock <= ?', [umbral]);
  return { umbral, total: Number(total), productos: filas };
}

/** Catálogo completo (con el mismo criterio de búsqueda del listado) para exportar. */
async function filasParaExportar(q) {
  const params = [];
  let where = '';
  if (q) { where = 'WHERE (p.nombre LIKE ? OR p.sku LIKE ?)'; const pat = `%${escaparLike(q)}%`; params.push(pat, pat); }
  const [filas] = await pool.query(
    `SELECT ${CAMPOS} FROM productos p ${where} ORDER BY p.id ASC LIMIT 50000`, params,
  );
  return filas;
}

module.exports = { categorias, stockBajo, filasParaExportar, listar, obtener, crear, actualizar, eliminar };
