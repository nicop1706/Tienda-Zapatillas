const { AppError } = require('./errores');

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_SKU = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

function fechaValida(texto) {
  const m = RE_FECHA.exec(texto);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}

/** Entero positivo estricto a partir de string/number. Devuelve null si no es válido. */
function enteroPositivo(valor, max = 2147483647) {
  if (typeof valor === 'number' && Number.isInteger(valor)) valor = String(valor);
  if (typeof valor !== 'string' || !/^\d{1,10}$/.test(valor.trim())) return null;
  const n = Number(valor);
  return n >= 1 && n <= max ? n : null;
}

function parseId(valor, nombre = 'id') {
  const n = enteroPositivo(valor);
  if (n === null) throw new AppError(400, `El parámetro «${nombre}» debe ser un entero positivo.`, 'PARAMETRO_INVALIDO');
  return n;
}

/** Lee desde/hasta (YYYY-MM-DD, ambos opcionales, hasta inclusive). */
function parseRangoFechas(query) {
  const rango = { desde: null, hasta: null };
  for (const k of ['desde', 'hasta']) {
    const v = query[k];
    if (v === undefined || v === '') continue;
    if (typeof v !== 'string' || !fechaValida(v)) {
      throw new AppError(400, `La fecha «${k}» debe tener el formato AAAA-MM-DD y ser válida.`, 'PARAMETRO_INVALIDO');
    }
    rango[k] = v;
  }
  if (rango.desde && rango.hasta && rango.desde > rango.hasta) {
    throw new AppError(400, 'La fecha «desde» no puede ser posterior a «hasta».', 'RANGO_INVALIDO');
  }
  return rango;
}

function parsePaginacion(query, { limiteMax = 100, limiteDefecto = 10 } = {}) {
  let page = 1;
  let limit = limiteDefecto;
  if (query.page !== undefined && query.page !== '') {
    page = enteroPositivo(query.page, 1000000);
    if (page === null) throw new AppError(400, 'El parámetro «page» debe ser un entero positivo.', 'PARAMETRO_INVALIDO');
  }
  if (query.limit !== undefined && query.limit !== '') {
    limit = enteroPositivo(query.limit, limiteMax);
    if (limit === null) throw new AppError(400, `El parámetro «limit» debe estar entre 1 y ${limiteMax}.`, 'PARAMETRO_INVALIDO');
  }
  return { page, limit, offset: (page - 1) * limit };
}

/** Convierte un importe a céntimos enteros. Acepta number o string con hasta 2 decimales. */
function aCentimos(valor) {
  const txt = typeof valor === 'number' ? String(valor) : typeof valor === 'string' ? valor.trim() : '';
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(txt)) return null;
  return Math.round(Number(txt) * 100);
}
const deCentimos = (c) => (c / 100).toFixed(2);

/**
 * Valida el cuerpo de un producto (alta o edición completa).
 * Devuelve { valores, errores }.
 */
function validarProducto(body) {
  const errores = {};
  const b = body && typeof body === 'object' ? body : {};
  const texto = (campo, etiqueta, max) => {
    const v = typeof b[campo] === 'string' ? b[campo].trim().replace(/\s+/g, ' ') : '';
    if (!v) errores[campo] = `${etiqueta} es obligatorio.`;
    else if (v.length > max) errores[campo] = `${etiqueta} no puede superar ${max} caracteres.`;
    return v;
  };

  const sku = (typeof b.sku === 'string' ? b.sku.trim().toUpperCase() : '');
  if (!sku) errores.sku = 'El SKU es obligatorio.';
  else if (!RE_SKU.test(sku)) errores.sku = 'El SKU debe tener de 3 a 40 caracteres: letras, números, guion o guion bajo.';

  const nombre = texto('nombre', 'El nombre', 120);
  const marca = texto('marca', 'La marca', 60);
  const modelo = texto('modelo', 'El modelo', 60);
  const categoria = texto('categoria', 'La categoría', 60);

  let talla = null;
  const tallaTxt = typeof b.talla === 'number' ? String(b.talla) : typeof b.talla === 'string' ? b.talla.trim() : '';
  if (!/^\d{2}(\.\d)?$/.test(tallaTxt)) errores.talla = 'La talla debe ser un número válido (por ejemplo 42 o 42.5).';
  else {
    talla = Number(tallaTxt);
    if (talla < 20 || talla > 55) { errores.talla = 'La talla debe estar entre 20 y 55.'; talla = null; }
  }

  let precioC = aCentimos(b.precio);
  if (precioC === null) errores.precio = 'El precio debe ser un número válido con hasta 2 decimales.';
  else if (precioC <= 0) { errores.precio = 'El precio debe ser mayor que cero.'; precioC = null; }

  let stock = null;
  const stockTxt = typeof b.stock === 'number' ? String(b.stock) : typeof b.stock === 'string' ? b.stock.trim() : '';
  if (!/^\d{1,9}$/.test(stockTxt)) errores.stock = 'El stock debe ser un número entero mayor o igual a cero.';
  else stock = Number(stockTxt);

  let descripcion = null;
  if (b.descripcion !== undefined && b.descripcion !== null && b.descripcion !== '') {
    if (typeof b.descripcion !== 'string') errores.descripcion = 'La descripción debe ser texto.';
    else {
      descripcion = b.descripcion.trim().replace(/\s+/g, ' ');
      if (descripcion.length > 255) errores.descripcion = 'La descripción no puede superar 255 caracteres.';
      if (!descripcion) descripcion = null;
    }
  }

  return {
    errores,
    valores: { sku, nombre, marca, modelo, talla, categoria, descripcion, precio: precioC === null ? null : deCentimos(precioC), stock },
  };
}

module.exports = {
  fechaValida, enteroPositivo, parseId, parseRangoFechas, parsePaginacion,
  aCentimos, deCentimos, validarProducto,
};
