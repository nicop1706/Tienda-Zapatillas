const ExcelJS = require('exceljs');
const { pool } = require('../configuracion/baseDatos');
const sales = require('./ventasServicio');
const { filtroFechas } = sales;

const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

async function tendencias() {
  const [[r]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN v.fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN v.subtotal END), 0) AS imp_act,
       COALESCE(SUM(CASE WHEN v.fecha < DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN v.subtotal END), 0) AS imp_ant,
       COUNT(CASE WHEN v.fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN 1 END) AS n_act,
       COUNT(CASE WHEN v.fecha < DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN 1 END) AS n_ant
     FROM ventas v
     WHERE v.estado = 'completada'
       AND v.fecha >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
       AND v.fecha < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
       AND (v.fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
            OR v.fecha < DATE_ADD(DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH), INTERVAL DAYOFMONTH(CURDATE()) DAY))`,
  );
  const [[u]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN v.fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN d.cantidad END), 0) AS u_act,
       COALESCE(SUM(CASE WHEN v.fecha < DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN d.cantidad END), 0) AS u_ant
     FROM ventas v JOIN detalle_ventas d ON d.venta_id = v.id
     WHERE v.estado = 'completada'
       AND v.fecha >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
       AND v.fecha < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
       AND (v.fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
            OR v.fecha < DATE_ADD(DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH), INTERVAL DAYOFMONTH(CURDATE()) DAY))`,
  );
  const act = { importe: Number(r.imp_act), ventas: Number(r.n_act), unidades: Number(u.u_act) };
  const ant = { importe: Number(r.imp_ant), ventas: Number(r.n_ant), unidades: Number(u.u_ant) };
  return {
    criterio: 'Mes en curso (hasta hoy) frente al mismo tramo de días del mes anterior. Importes sin IGV.',
    actual: act, anterior: ant,
    variacion_pct: { importe: pct(act.importe, ant.importe), ventas: pct(act.ventas, ant.ventas), unidades: pct(act.unidades, ant.unidades) },
  };
}

async function actividad(limite = 8) {
  const [v] = await pool.query(
    "SELECT 'venta' AS tipo, id AS ref, fecha, total AS monto, estado FROM ventas ORDER BY fecha DESC, id DESC LIMIT ?", [limite]);
  const [p] = await pool.query(
    "SELECT 'prediccion' AS tipo, id AS ref, creado_en AS fecha, estimacion AS monto, periodo AS estado FROM historial_predicciones ORDER BY id DESC LIMIT ?", [limite]);
  return [...v, ...p].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, limite).map((f) => ({ ...f, monto: Number(f.monto) }));
}

async function resumen(rango) {
  const f = filtroFechas(rango);
  const [[t]] = await pool.query(
    `SELECT COUNT(*) AS ventas, COALESCE(SUM(v.subtotal),0) AS subtotal, COALESCE(SUM(v.igv),0) AS igv, COALESCE(SUM(v.total),0) AS total
     FROM ventas v WHERE v.estado = 'completada'${f.sql}`, f.params);
  const [[an]] = await pool.query(`SELECT COUNT(*) AS n FROM ventas v WHERE v.estado = 'anulada'${f.sql}`, f.params);
  const [[un]] = await pool.query(
    `SELECT COALESCE(SUM(d.cantidad),0) AS u FROM detalle_ventas d JOIN ventas v ON v.id = d.venta_id
     WHERE v.estado = 'completada'${f.sql}`, f.params);
  const ventas = Number(t.ventas);
  return {
    kpis: {
      ventas: ventas, anuladas: Number(an.n), unidades: Number(un.u),
      subtotal: Number(t.subtotal), igv: Number(t.igv), total: Number(t.total),
      ticket_promedio: ventas ? Math.round((Number(t.total) / ventas) * 100) / 100 : null,
    },
    por_categoria: await sales.porCategoria(rango),
    por_producto: await porProducto(rango),
    mensual: await sales.totalesMensuales(rango),
  };
}

async function porProducto(rango) {
  const f = filtroFechas(rango);
  const [filas] = await pool.query(
    `SELECT p.sku, p.nombre, p.marca, p.categoria, SUM(d.cantidad) AS unidades, SUM(d.subtotal) AS neto
     FROM detalle_ventas d JOIN ventas v ON v.id = d.venta_id JOIN productos p ON p.id = d.producto_id
     WHERE v.estado = 'completada'${f.sql}
     GROUP BY p.id, p.sku, p.nombre, p.marca, p.categoria
     ORDER BY unidades DESC, p.id ASC`, f.params);
  return filas.map((r) => ({ ...r, unidades: Number(r.unidades), neto: Number(r.neto) }));
}

async function libroXlsx(rango) {
  const r = await resumen(rango);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FootWear Admin';
  wb.created = new Date();
  const dinero = '"S/" #,##0.00';
  const negrita = (ws) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };

  const h1 = wb.addWorksheet('Resumen');
  h1.columns = [{ header: 'Indicador', width: 34 }, { header: 'Valor', width: 20 }];
  h1.addRows([
    ['Periodo', `${rango.desde || 'inicio'} a ${rango.hasta || 'hoy'}`],
    ['Ventas completadas', r.kpis.ventas], ['Ventas anuladas (no cuentan)', r.kpis.anuladas],
    ['Unidades vendidas', r.kpis.unidades], ['Subtotal (sin IGV)', r.kpis.subtotal],
    ['IGV (18 %)', r.kpis.igv], ['Total facturado', r.kpis.total], ['Ticket promedio', r.kpis.ticket_promedio],
  ]);
  [5, 6, 7, 8].forEach((i) => { h1.getCell(`B${i + 1}`).numFmt = dinero; });
  negrita(h1);

  const h2 = wb.addWorksheet('Por producto');
  h2.columns = [{ header: 'SKU', key: 'sku', width: 16 }, { header: 'Producto', key: 'nombre', width: 28 }, { header: 'Marca', key: 'marca', width: 14 },
    { header: 'Categoría', key: 'categoria', width: 14 }, { header: 'Unidades', key: 'unidades', width: 11 }, { header: 'Neto (S/)', key: 'neto', width: 14, style: { numFmt: dinero } }];
  h2.addRows(r.por_producto); negrita(h2);

  const h3 = wb.addWorksheet('Por categoría');
  h3.columns = [{ header: 'Categoría', key: 'categoria', width: 18 }, { header: 'Unidades', key: 'unidades', width: 11 }, { header: 'Neto (S/)', key: 'importe', width: 14, style: { numFmt: dinero } }];
  h3.addRows(r.por_categoria); negrita(h3);

  const filas = await sales.filasParaExportar({ rango, productoId: null, estado: 'completada' });
  const h4 = wb.addWorksheet('Ventas');
  h4.columns = [{ header: 'N.º venta', key: 'venta_id', width: 10 }, { header: 'Fecha', key: 'fecha', width: 20 }, { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Producto', key: 'producto', width: 28 }, { header: 'Cant.', key: 'cantidad', width: 8 },
    { header: 'P. unitario', key: 'precio_unitario', width: 13, style: { numFmt: dinero } }, { header: 'Subtotal', key: 'subtotal', width: 13, style: { numFmt: dinero } }];
  h4.addRows(filas); negrita(h4);
  return wb.xlsx.writeBuffer();
}

module.exports = { tendencias, actividad, resumen, porProducto, libroXlsx };
