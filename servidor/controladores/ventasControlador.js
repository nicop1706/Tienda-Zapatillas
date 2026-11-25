const salesService = require('../servicios/ventasServicio');
const { AppError, asyncHandler } = require('../utilidades/errores');
const { ok } = require('../utilidades/respuesta');
const { enviarCsv } = require('../utilidades/csv');
const { parseId, parsePaginacion, parseRangoFechas } = require('../utilidades/validadores');

const listar = asyncHandler(async (req, res) => {
  const rango = parseRangoFechas(req.query);
  const pag = parsePaginacion(req.query, { limiteMax: 100, limiteDefecto: 10 });
  const productoId = req.query.producto_id ? parseId(req.query.producto_id, 'producto_id') : null;
  let estado = null;
  if (req.query.estado) {
    if (!['completada', 'anulada'].includes(req.query.estado)) {
      throw new AppError(400, 'El estado debe ser «completada» o «anulada».', 'PARAMETRO_INVALIDO');
    }
    estado = req.query.estado;
  }
  const r = await salesService.listar({ rango, productoId, estado, ...pag });
  ok(res, r.filas, { total: r.total, page: r.page, limit: r.limit, paginas: r.paginas, totales: r.totales });
});

const registrar = asyncHandler(async (req, res) => {
  ok(res, await salesService.registrar(req.body), undefined, 201);
});

const obtener = asyncHandler(async (req, res) => {
  ok(res, await salesService.obtener(parseId(req.params.id)));
});

const anular = asyncHandler(async (req, res) => {
  ok(res, await salesService.anular(parseId(req.params.id)));
});

const mensual = asyncHandler(async (req, res) => {
  ok(res, await salesService.mensualTop5(parseRangoFechas(req.query)));
});

const exportar = asyncHandler(async (req, res) => {
  const rango = parseRangoFechas(req.query);
  const productoId = req.query.producto_id ? parseId(req.query.producto_id, 'producto_id') : null;
  let estado = null;
  if (req.query.estado) {
    if (!['completada', 'anulada'].includes(req.query.estado)) {
      throw new AppError(400, 'El estado debe ser «completada» o «anulada».', 'PARAMETRO_INVALIDO');
    }
    estado = req.query.estado;
  }
  const filas = await salesService.filasParaExportar({ rango, productoId, estado });
  enviarCsv(res, 'ventas.csv', [
    { titulo: 'N.º de venta', campo: 'venta_id' }, { titulo: 'Fecha y hora', campo: 'fecha' },
    { titulo: 'Estado', campo: 'estado' }, { titulo: 'SKU', campo: 'sku' }, { titulo: 'Producto', campo: 'producto' },
    { titulo: 'Cantidad', campo: 'cantidad' }, { titulo: 'Precio unitario (S/)', campo: 'precio_unitario' },
    { titulo: 'Subtotal (S/)', campo: 'subtotal' },
  ], filas);
});

module.exports = { obtener, exportar, listar, registrar, anular, mensual };
