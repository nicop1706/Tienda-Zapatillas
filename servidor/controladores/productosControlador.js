const productsService = require('../servicios/productosServicio');
const imagesService = require('../servicios/imagenesServicio');
const salesService = require('../servicios/ventasServicio');
const { AppError, asyncHandler } = require('../utilidades/errores');
const { ok } = require('../utilidades/respuesta');
const { enviarCsv } = require('../utilidades/csv');
const { parseId, parsePaginacion, parseRangoFechas, validarProducto } = require('../utilidades/validadores');

function exigirProductoValido(body) {
  const { valores, errores } = validarProducto(body);
  if (Object.keys(errores).length) {
    throw new AppError(400, 'Hay datos de producto no válidos. Revisa los campos indicados.', 'VALIDACION', errores);
  }
  return valores;
}

const listar = asyncHandler(async (req, res) => {
  const pag = parsePaginacion(req.query, { limiteMax: 100, limiteDefecto: 10 });
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const categoria = typeof req.query.categoria === 'string' ? req.query.categoria.trim().slice(0, 60) : '';
  const r = await productsService.listar({
    ...pag, q, categoria,
    orden: typeof req.query.orden === 'string' ? req.query.orden : 'id',
    direccion: typeof req.query.direccion === 'string' ? req.query.direccion : 'asc',
    soloConStock: req.query.solo_con_stock === '1',
  });
  ok(res, r.filas, { total: r.total, page: r.page, limit: r.limit, paginas: r.paginas });
});

const topSelling = asyncHandler(async (req, res) => {
  const rango = parseRangoFechas(req.query);
  const data = await salesService.topVendidos(rango, 5);
  ok(res, data, {
    criterio: 'Unidades vendidas de ventas completadas' + (rango.desde || rango.hasta ? ' dentro del periodo filtrado.' : ' en todo el historial.'),
    cantidad: data.length,
  });
});

const categorias = asyncHandler(async (req, res) => ok(res, await productsService.categorias()));

const obtener = asyncHandler(async (req, res) => {
  ok(res, await productsService.obtener(parseId(req.params.id)));
});

const crear = asyncHandler(async (req, res) => {
  const valores = exigirProductoValido(req.body);
  ok(res, await productsService.crear(valores), undefined, 201);
});

const actualizar = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const valores = exigirProductoValido(req.body);
  ok(res, await productsService.actualizar(id, valores));
});

const eliminar = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  let sku = null;
  try { sku = (await productsService.obtener(id)).sku; } catch (_) { /* eliminar() informará si no existe */ }
  await productsService.eliminar(id);
  if (sku) await imagesService.quitarSiExiste(id, sku);   // no deja fotos huérfanas
  ok(res, { eliminado: true });
});

const exportar = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const filas = await productsService.filasParaExportar(q);
  enviarCsv(res, 'productos.csv', [
    { titulo: 'ID', campo: 'id' }, { titulo: 'SKU', campo: 'sku' }, { titulo: 'Nombre', campo: 'nombre' },
    { titulo: 'Marca', campo: 'marca' }, { titulo: 'Modelo', campo: 'modelo' }, { titulo: 'Talla', campo: 'talla' },
    { titulo: 'Categoría', campo: 'categoria' }, { titulo: 'Descripción', campo: 'descripcion' }, { titulo: 'Precio (S/)', campo: 'precio' },
    { titulo: 'Stock', campo: 'stock' }, { titulo: 'Creado en', campo: 'creado_en' },
  ], filas);
});

const imagenes = asyncHandler(async (req, res) => {
  ok(res, await imagesService.listar());
});
const subirImagen = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    throw new AppError(400, 'Envía una imagen JPG, PNG o WebP de hasta 3 MB.', 'VALIDACION');
  }
  ok(res, await imagesService.guardar(id, req.body));
});
const quitarImagen = asyncHandler(async (req, res) => {
  await imagesService.quitar(parseId(req.params.id));
  ok(res, { quitada: true });
});

module.exports = { imagenes, subirImagen, quitarImagen, categorias, exportar, listar, topSelling, obtener, crear, actualizar, eliminar };
