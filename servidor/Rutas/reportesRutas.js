const router = require('express').Router();
const reports = require('../servicios/reportesServicio');
const { ok } = require('../utilidades/respuesta');
const { asyncHandler } = require('../utilidades/errores');
const { parseRangoFechas } = require('../utilidades/validadores');
const { enviarCsv } = require('../utilidades/csv');

router.get('/summary', asyncHandler(async (req, res) => ok(res, await reports.resumen(parseRangoFechas(req.query)))));

router.get('/export.csv', asyncHandler(async (req, res) => {
  const filas = await reports.porProducto(parseRangoFechas(req.query));
  enviarCsv(res, 'reporte-ventas.csv', [
    { titulo: 'SKU', campo: 'sku' }, { titulo: 'Producto', campo: 'nombre' }, { titulo: 'Marca', campo: 'marca' },
    { titulo: 'Categoría', campo: 'categoria' }, { titulo: 'Unidades', campo: 'unidades' }, { titulo: 'Neto sin IGV (S/)', campo: 'neto' },
  ], filas);
}));

router.get('/export.xlsx', asyncHandler(async (req, res) => {
  const buf = await reports.libroXlsx(parseRangoFechas(req.query));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="reporte-ventas.xlsx"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(buf));
}));

module.exports = router;
