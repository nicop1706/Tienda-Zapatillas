const { pool } = require('../configuracion/baseDatos');
const { AppError } = require('../utilidades/errores');
const { aCentimos, deCentimos, enteroPositivo } = require('../utilidades/validadores');
const { sumarDia, rangoMeses, etiquetaCorta, parseClave, mesAbsoluto } = require('../utilidades/fechas');

const MAX_LINEAS = 20;
const MAX_CANTIDAD = 10000;
const MAX_MESES_GRAFICO = 60;
// IGV (Perú) 18 %, en porcentaje entero para operar en céntimos sin errores de coma flotante
const IGV_PORCENTAJE = 18;
const calcularIgvC = (subtotalC) => Math.round((subtotalC * IGV_PORCENTAJE) / 100);

/** Condición SQL de rango de fechas sobre ventas (alias v). `hasta` es inclusive. */
function filtroFechas(rango, alias = 'v') {
  let sql = '';
  const params = [];
  if (rango.desde) { sql += ` AND ${alias}.fecha >= ?`; params.push(rango.desde); }
  if (rango.hasta) { sql += ` AND ${alias}.fecha < ?`; params.push(sumarDia(rango.hasta)); }
  return { sql, params };
}

// ------------------------------------------------------------------ registrar
function normalizarItems(body) {
  let items = body && Array.isArray(body.items) ? body.items : null;
  if (!items && body && body.producto_id !== undefined) {
    items = [{ producto_id: body.producto_id, cantidad: body.cantidad }];
  }
  if (!items || items.length === 0) {
    throw new AppError(400, 'Debes indicar al menos un producto y su cantidad.', 'VENTA_INVALIDA');
  }
  if (items.length > MAX_LINEAS) {
    throw new AppError(400, `Una venta admite como máximo ${MAX_LINEAS} líneas.`, 'VENTA_INVALIDA');
  }
  const acumulado = new Map();
  const errores = [];
  items.forEach((it, i) => {
    const productoId = enteroPositivo(it && it.producto_id);
    const cantidad = enteroPositivo(it && it.cantidad, MAX_CANTIDAD);
    if (productoId === null) errores.push(`Línea ${i + 1}: producto no válido.`);
    else if (cantidad === null) errores.push(`Línea ${i + 1}: la cantidad debe ser un entero entre 1 y ${MAX_CANTIDAD}.`);
    else acumulado.set(productoId, (acumulado.get(productoId) || 0) + cantidad);
  });
  if (errores.length) throw new AppError(400, errores[0], 'VENTA_INVALIDA', errores);
  return [...acumulado.entries()].map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
}

/**
 * Registra una venta. El backend obtiene el precio vigente desde la base de datos y calcula
 * subtotales y total en céntimos enteros; todo dentro de una transacción con bloqueo de filas.
 */
async function registrar(body) {
  const items = normalizarItems(body);
  const ids = items.map((i) => i.producto_id).sort((a, b) => a - b);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // FOR UPDATE + orden por id: evita sobreventa concurrente y reduce interbloqueos
    const [prods] = await conn.query(
      'SELECT id, nombre, precio, stock FROM productos WHERE id IN (?) ORDER BY id FOR UPDATE',
      [ids],
    );
    const porId = new Map(prods.map((p) => [p.id, p]));

    let totalC = 0;
    const lineas = [];
    for (const it of items.sort((a, b) => a.producto_id - b.producto_id)) {
      const p = porId.get(it.producto_id);
      if (!p) throw new AppError(404, `El producto con id ${it.producto_id} no existe.`, 'PRODUCTO_NO_ENCONTRADO');
      if (it.cantidad > p.stock) {
        throw new AppError(
          409,
          `Stock insuficiente para «${p.nombre}»: disponible ${p.stock}, solicitado ${it.cantidad}.`,
          'STOCK_INSUFICIENTE',
        );
      }
      const precioC = aCentimos(p.precio.toFixed(2));
      const subtotalC = precioC * it.cantidad;
      totalC += subtotalC;
      lineas.push({ ...it, nombre: p.nombre, precioC, subtotalC });
    }

    const igvC = calcularIgvC(totalC);
    const [rv] = await conn.execute(
      'INSERT INTO ventas (estado, subtotal, igv, total) VALUES (?, ?, ?, ?)',
      ['completada', deCentimos(totalC), deCentimos(igvC), deCentimos(totalC + igvC)],
    );
    const ventaId = rv.insertId;

    for (const l of lineas) {
      await conn.execute(
        'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)',
        [ventaId, l.producto_id, l.cantidad, deCentimos(l.precioC), deCentimos(l.subtotalC)],
      );
      // La condición stock >= ? es una segunda barrera: nunca deja el stock en negativo
      const [ru] = await conn.execute(
        'UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?',
        [l.cantidad, l.producto_id, l.cantidad],
      );
      if (ru.affectedRows !== 1) {
        throw new AppError(409, `Stock insuficiente para «${l.nombre}».`, 'STOCK_INSUFICIENTE');
      }
    }

    const [[fv]] = await conn.execute('SELECT fecha FROM ventas WHERE id = ?', [ventaId]);
    await conn.commit();
    return {
      id: ventaId,
      fecha: fv.fecha,
      subtotal: totalC / 100,
      igv: igvC / 100,
      total: (totalC + igvC) / 100,
      igv_porcentaje: IGV_PORCENTAJE,
      lineas: lineas.map((l) => ({
        producto_id: l.producto_id, producto: l.nombre, cantidad: l.cantidad,
        precio_unitario: l.precioC / 100, subtotal: l.subtotalC / 100,
      })),
    };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* conexión ya cerrada */ }
    throw err;
  } finally {
    conn.release();
  }
}

// -------------------------------------------------------------------- anular
async function anular(id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ventas] = await conn.execute('SELECT id, estado FROM ventas WHERE id = ? FOR UPDATE', [id]);
    if (!ventas.length) throw new AppError(404, 'La venta no existe.', 'VENTA_NO_ENCONTRADA');
    if (ventas[0].estado === 'anulada') throw new AppError(409, 'La venta ya estaba anulada.', 'VENTA_YA_ANULADA');

    const [lineas] = await conn.execute(
      'SELECT producto_id, cantidad FROM detalle_ventas WHERE venta_id = ? ORDER BY producto_id',
      [id],
    );
    for (const l of lineas) {
      await conn.execute('UPDATE productos SET stock = stock + ? WHERE id = ?', [l.cantidad, l.producto_id]);
    }
    await conn.execute("UPDATE ventas SET estado = 'anulada', anulada_en = NOW() WHERE id = ?", [id]);
    await conn.commit();
    return { id, estado: 'anulada', unidades_devueltas: lineas.reduce((a, l) => a + l.cantidad, 0) };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    throw err;
  } finally {
    conn.release();
  }
}

// ------------------------------------------------------------------- listado
/**
 * Historial de ventas: UNA fila por venta (comprobante), con subtotal, IGV y total.
 * El filtro por producto muestra las ventas que contienen ese producto.
 * `totales` solo suma ventas completadas dentro de los mismos filtros.
 */
async function listar({ rango, productoId, estado, page, limit, offset }) {
  const f = filtroFechas(rango);
  let where = `WHERE 1 = 1${f.sql}`;
  const params = [...f.params];
  if (productoId) {
    where += ' AND EXISTS (SELECT 1 FROM detalle_ventas dx WHERE dx.venta_id = v.id AND dx.producto_id = ?)';
    params.push(productoId);
  }
  if (estado) { where += ' AND v.estado = ?'; params.push(estado); }

  const [[{ n }]] = await pool.execute(`SELECT COUNT(*) AS n FROM ventas v ${where}`, params);
  const [filas] = await pool.query(
    `SELECT v.id, v.fecha, v.estado, v.subtotal, v.igv, v.total,
            (SELECT COALESCE(SUM(d.cantidad), 0) FROM detalle_ventas d WHERE d.venta_id = v.id) AS unidades,
            (SELECT GROUP_CONCAT(p.nombre ORDER BY d.id SEPARATOR ', ')
               FROM detalle_ventas d JOIN productos p ON p.id = d.producto_id WHERE d.venta_id = v.id) AS productos
     FROM ventas v ${where} ORDER BY v.fecha DESC, v.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [[tot]] = await pool.execute(
    `SELECT COALESCE(SUM(v.subtotal), 0) AS subtotal, COALESCE(SUM(v.igv), 0) AS igv, COALESCE(SUM(v.total), 0) AS total
     FROM ventas v ${where} AND v.estado = 'completada'`,
    params,
  );
  return {
    filas: filas.map((r) => ({ ...r, unidades: Number(r.unidades) })),
    total: n, page, limit, paginas: Math.max(1, Math.ceil(n / limit)),
    totales: { subtotal: Number(tot.subtotal), igv: Number(tot.igv), total_facturado: Number(tot.total) },
  };
}

/** Comprobante de una venta con sus líneas. */
async function obtener(id) {
  const [[v]] = await pool.execute('SELECT id, fecha, estado, subtotal, igv, total, anulada_en FROM ventas WHERE id = ?', [id]);
  if (!v) throw new AppError(404, 'La venta no existe.', 'VENTA_NO_ENCONTRADA');
  const [lineas] = await pool.execute(
    `SELECT d.id, d.producto_id, p.nombre AS producto, p.sku, d.cantidad, d.precio_unitario, d.subtotal
     FROM detalle_ventas d JOIN productos p ON p.id = d.producto_id WHERE d.venta_id = ? ORDER BY d.id`,
    [id],
  );
  return { ...v, igv_porcentaje: IGV_PORCENTAJE, lineas };
}

// ----------------------------------------------------------------- top ventas
/**
 * Top N por UNIDADES vendidas dentro del periodo filtrado (o histórico completo si no hay filtro).
 * Excluye ventas anuladas. Desempate: id de producto ascendente.
 */
async function topVendidos(rango, limite = 5) {
  const f = filtroFechas(rango);
  const [filas] = await pool.query(
    `SELECT p.id, p.nombre, p.marca,
            SUM(d.cantidad) AS unidades_vendidas,
            SUM(d.subtotal) AS importe_facturado
     FROM productos p
     INNER JOIN detalle_ventas d ON d.producto_id = p.id
     INNER JOIN ventas v ON v.id = d.venta_id
     WHERE v.estado = 'completada'${f.sql}
     GROUP BY p.id, p.nombre, p.marca
     ORDER BY unidades_vendidas DESC, p.id ASC
     LIMIT ?`,
    [...f.params, limite],
  );
  return filas.map((r) => ({
    id: r.id, nombre: r.nombre, marca: r.marca,
    unidades_vendidas: Number(r.unidades_vendidas),
    importe_facturado: Number(r.importe_facturado),
  }));
}

// ------------------------------------------------------------ meses del periodo
async function mesActual() {
  const [[r]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m') AS ym");
  return r.ym;
}

/**
 * Determina los meses del eje horizontal.
 * - Inicio: mes de «desde», o el mes de la primera venta completada.
 * - Fin: mes de «hasta» (sin pasar del mes actual), o el mes de la última venta.
 * - Máximo 60 meses (los más recientes). Sin ventas completadas => lista vacía.
 */
async function resolverMeses(rango) {
  const [[lim]] = await pool.query(
    `SELECT DATE_FORMAT(MIN(fecha), '%Y-%m') AS primero, DATE_FORMAT(MAX(fecha), '%Y-%m') AS ultimo
     FROM ventas WHERE estado = 'completada'`,
  );
  if (!lim.primero) return [];
  const actual = await mesActual();
  let inicio = rango.desde ? rango.desde.slice(0, 7) : lim.primero;
  let fin = rango.hasta ? rango.hasta.slice(0, 7) : lim.ultimo;
  if (fin > actual) fin = actual;
  if (inicio > fin) return [];
  let meses = rangoMeses(inicio, fin);
  if (meses.length > MAX_MESES_GRAFICO) meses = meses.slice(-MAX_MESES_GRAFICO);
  return meses;
}

/**
 * Ventas mensuales (unidades) de los productos del Top 5.
 * CRITERIO: los 5 productos se eligen con el MISMO filtro de fechas aplicado a la serie
 * (total del periodo filtrado; sin filtro = total histórico).
 */
async function mensualTop5(rango) {
  const top = await topVendidos(rango, 5);
  const meses = await resolverMeses(rango);
  const criterio = rango.desde || rango.hasta
    ? 'Top 5 por unidades vendidas dentro del periodo filtrado.'
    : 'Top 5 por unidades vendidas en todo el historial.';
  if (!top.length || !meses.length) return { criterio, meses: [], series: [] };

  const f = filtroFechas(rango);
  const ids = top.map((t) => t.id);
  const [filas] = await pool.query(
    `SELECT d.producto_id, DATE_FORMAT(v.fecha, '%Y-%m') AS ym, SUM(d.cantidad) AS unidades
     FROM detalle_ventas d INNER JOIN ventas v ON v.id = d.venta_id
     WHERE v.estado = 'completada' AND d.producto_id IN (?)${f.sql}
     GROUP BY d.producto_id, ym`,
    [ids, ...f.params],
  );
  const mapa = new Map(filas.map((r) => [`${r.producto_id}|${r.ym}`, Number(r.unidades)]));
  // Un mes sin filas para ese producto, dentro de un periodo cuya consulta SÍ se ejecutó, equivale a 0 unidades
  const series = top.map((t) => ({
    producto_id: t.id, nombre: t.nombre, marca: t.marca, total_unidades: t.unidades_vendidas,
    datos: meses.map((m) => mapa.get(`${t.id}|${m}`) || 0),
  }));
  return {
    criterio,
    meses: meses.map((m) => ({ clave: m, etiqueta: etiquetaCorta(m) })),
    series,
  };
}

/** Ventas mensuales totales (S/ y unidades) para el gráfico general del dashboard. */
async function totalesMensuales(rango) {
  const meses = await resolverMeses(rango);
  if (!meses.length) return { meses: [], importe: [], unidades: [] };
  const f = filtroFechas(rango);
  const [filas] = await pool.query(
    `SELECT DATE_FORMAT(v.fecha, '%Y-%m') AS ym, SUM(d.subtotal) AS importe, SUM(d.cantidad) AS unidades
     FROM ventas v INNER JOIN detalle_ventas d ON d.venta_id = v.id
     WHERE v.estado = 'completada'${f.sql}
     GROUP BY ym`,
    f.params,
  );
  const mapa = new Map(filas.map((r) => [r.ym, r]));
  return {
    meses: meses.map((m) => ({ clave: m, etiqueta: etiquetaCorta(m) })),
    importe: meses.map((m) => (mapa.has(m) ? Number(mapa.get(m).importe) : 0)),
    unidades: meses.map((m) => (mapa.has(m) ? Number(mapa.get(m).unidades) : 0)),
  };
}

async function resumen(rango) {
  const f = filtroFechas(rango);
  const [[t]] = await pool.execute(
    `SELECT COALESCE(SUM(d.subtotal), 0) AS importe, COALESCE(SUM(d.cantidad), 0) AS unidades,
            COUNT(DISTINCT v.id) AS ventas
     FROM ventas v INNER JOIN detalle_ventas d ON d.venta_id = v.id
     WHERE v.estado = 'completada'${f.sql}`,
    f.params,
  );
  const [[pr]] = await pool.execute(
    'SELECT COUNT(*) AS total, COALESCE(SUM(stock = 0), 0) AS sin_stock FROM productos',
  );
  return {
    ventas_totales: Number(t.importe),
    unidades_vendidas: Number(t.unidades),
    numero_ventas: Number(t.ventas),
    productos_registrados: Number(pr.total),
    productos_sin_stock: Number(pr.sin_stock),
    top_5: await topVendidos(rango, 5),
  };
}


// ------------------------------------------------------- reportes adicionales
/** Ventas completadas agrupadas por categoría de producto dentro del periodo filtrado. */
async function porCategoria(rango) {
  const f = filtroFechas(rango);
  const [filas] = await pool.query(
    `SELECT p.categoria, SUM(d.cantidad) AS unidades, SUM(d.subtotal) AS importe
     FROM detalle_ventas d
     INNER JOIN ventas v ON v.id = d.venta_id
     INNER JOIN productos p ON p.id = d.producto_id
     WHERE v.estado = 'completada'${f.sql}
     GROUP BY p.categoria
     ORDER BY importe DESC, p.categoria ASC`,
    f.params,
  );
  return filas.map((r) => ({ categoria: r.categoria, unidades: Number(r.unidades), importe: Number(r.importe) }));
}

const MAX_FILAS_EXPORTACION = 50000;

/** Filas del historial para exportar (mismos filtros que el listado, sin paginar, con tope). */
async function filasParaExportar({ rango, productoId, estado }) {
  const f = filtroFechas(rango);
  let where = `WHERE 1 = 1${f.sql}`;
  const params = [...f.params];
  if (productoId) { where += ' AND d.producto_id = ?'; params.push(productoId); }
  if (estado) { where += ' AND v.estado = ?'; params.push(estado); }
  const [filas] = await pool.query(
    `SELECT v.id AS venta_id, v.fecha, v.estado, p.sku, p.nombre AS producto,
            d.cantidad, d.precio_unitario, d.subtotal
     FROM detalle_ventas d
     INNER JOIN ventas v ON v.id = d.venta_id
     INNER JOIN productos p ON p.id = d.producto_id ${where}
     ORDER BY v.fecha DESC, d.id DESC LIMIT ?`,
    [...params, MAX_FILAS_EXPORTACION],
  );
  return filas;
}

module.exports = {
  IGV_PORCENTAJE, obtener, porCategoria, filasParaExportar, registrar, anular, listar, topVendidos, mensualTop5, totalesMensuales, resumen,
  mesActual, filtroFechas, parseClave, mesAbsoluto,
};
