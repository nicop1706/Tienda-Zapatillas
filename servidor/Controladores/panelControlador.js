const salesService = require('../servicios/ventasServicio');
const productsService = require('../servicios/productosServicio');
const { AppError, asyncHandler } = require('../utilidades/errores');
const { ok } = require('../utilidades/respuesta');
const { parseRangoFechas, enteroPositivo } = require('../utilidades/validadores');

const resumen = asyncHandler(async (req, res) => {
  ok(res, await salesService.resumen(parseRangoFechas(req.query)));
});

const ventasMensuales = asyncHandler(async (req, res) => {
  ok(res, await salesService.totalesMensuales(parseRangoFechas(req.query)));
});

const categorias = asyncHandler(async (req, res) => {
  ok(res, await salesService.porCategoria(parseRangoFechas(req.query)));
});

const stockBajo = asyncHandler(async (req, res) => {
  let umbral = 5;
  if (req.query.umbral !== undefined && req.query.umbral !== '') {
    umbral = req.query.umbral === '0' ? 0 : enteroPositivo(req.query.umbral, 1000);
    if (umbral === null) throw new AppError(400, 'El umbral debe ser un entero entre 0 y 1000.', 'PARAMETRO_INVALIDO');
  }
  ok(res, await productsService.stockBajo(umbral));
});

module.exports = { resumen, ventasMensuales, categorias, stockBajo };
