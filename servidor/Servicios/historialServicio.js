const crypto = require('crypto');
const { pool } = require('../configuracion/baseDatos');
const { AppError } = require('../utilidades/errores');
const { mesActual } = require('./ventasServicio');
const { clave, mesAbsoluto, parseClave, rangoMeses, etiquetaCorta } = require('../utilidades/fechas');

const MAX_FILAS_CSV = 600;
const MAX_ERRORES_REPORTADOS = 20;

async function obtenerSerie() {
  const actual = await mesActual();

  const [sistema] = await pool.query(
    `SELECT YEAR(v.fecha) AS anio, MONTH(v.fecha) AS mes, SUM(d.subtotal) AS total
     FROM ventas v INNER JOIN detalle_ventas d ON d.venta_id = v.id
     WHERE v.estado = 'completada' AND v.fecha < DATE_FORMAT(CURDATE(), '%Y-%m-01')
     GROUP BY anio, mes`,
  );
  const [importado] = await pool.query(
    'SELECT anio, mes, total_venta_mes AS total FROM historial_ventas_mensuales',
  );

  const porClave = new Map();
  for (const r of importado) {
    const c = clave(r.anio, r.mes);
    if (c < actual) porClave.set(c, { anio: r.anio, mes: r.mes, total: Number(r.total), origen: 'importado' });
  }
  let solapados = 0;
  for (const r of sistema) {
    const c = clave(r.anio, r.mes);
    if (porClave.has(c)) solapados += 1;
    porClave.set(c, { anio: r.anio, mes: r.mes, total: Number(r.total), origen: 'sistema' });
  }

  const claves = [...porClave.keys()].sort();
  const resultado = {
    serie: [], faltantes: [], primerMes: null, ultimoMes: null, mesActual: actual,
    fuentes: { sistema: 0, importado: 0, solapados_prevalece_sistema: solapados }, hash: null,
  };
  if (!claves.length) return resultado;

  const base = parseClave(claves[0]);
  const baseAbs = mesAbsoluto(base.anio, base.mes);
  resultado.serie = claves.map((c) => {
    const f = porClave.get(c);
    resultado.fuentes[f.origen] += 1;
    return {
      clave: c,
      etiqueta: etiquetaCorta(c),
      anio: f.anio,
      numero_mes: f.mes,
      indice: mesAbsoluto(f.anio, f.mes) - baseAbs + 1,
      total_venta_mes: Math.round(f.total * 100) / 100,
      origen: f.origen,
    };
  });
  resultado.primerMes = claves[0];
  resultado.ultimoMes = claves[claves.length - 1];
  resultado.faltantes = rangoMeses(claves[0], claves[claves.length - 1]).filter((c) => !porClave.has(c));
  resultado.hash = crypto
    .createHash('sha1')
    .update(resultado.serie.map((f) => `${f.clave}:${f.total_venta_mes.toFixed(2)}`).join('|'))
    .digest('hex');
  return resultado;
}


const COLUMNAS_ESPERADAS = ['anio', 'numero_mes', 'total_venta_mes'];

function parsearCsv(texto, mesActualClave) {
  if (typeof texto !== 'string' || !texto.trim()) {
    throw new AppError(400, 'El archivo CSV está vacío o no se recibió. Envíalo con Content-Type: text/csv.', 'CSV_INVALIDO');
  }
  if (texto.includes('\u0000')) {
    throw new AppError(400, 'El archivo no parece ser un CSV de texto válido.', 'CSV_INVALIDO');
  }
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/);
  const errores = [];
  const filas = [];
  const vistos = new Set();
  let separador = null;
  let cabeceraLeida = false;

  for (let i = 0; i < lineas.length; i++) {
    const nLinea = i + 1;
    const linea = lineas[i].trim();
    if (!linea || linea.startsWith('#')) continue;

    if (!cabeceraLeida) {
      separador = linea.includes(';') && !linea.includes(',') ? ';' : ',';
      const cols = linea.split(separador).map((c) => c.trim().toLowerCase());
      if (cols.length !== 3 || cols.some((c, k) => c !== COLUMNAS_ESPERADAS[k])) {
        throw new AppError(
          400,
          'Cabecera no válida. Debe ser exactamente: anio,numero_mes,total_venta_mes ' +
            '(el año es necesario para ordenar los meses cronológicamente).',
          'CSV_INVALIDO',
        );
      }
      cabeceraLeida = true;
      continue;
    }

    if (filas.length >= MAX_FILAS_CSV) {
      throw new AppError(413, `El CSV supera el máximo de ${MAX_FILAS_CSV} filas.`, 'CSV_DEMASIADO_GRANDE');
    }
    const campos = linea.split(separador).map((c) => c.trim());
    if (campos.length !== 3) { errores.push(`Línea ${nLinea}: se esperaban 3 columnas.`); continue; }
    const [a, m, t] = campos;
    if (!/^\d{4}$/.test(a) || Number(a) < 2000 || Number(a) > 2100) { errores.push(`Línea ${nLinea}: año no válido («${a.slice(0, 12)}»).`); continue; }
    if (!/^\d{1,2}$/.test(m) || Number(m) < 1 || Number(m) > 12) { errores.push(`Línea ${nLinea}: el número de mes debe estar entre 1 y 12.`); continue; }
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) { errores.push(`Línea ${nLinea}: el total debe ser un número no negativo con hasta 2 decimales.`); continue; }
    const c = clave(Number(a), Number(m));
    if (c >= mesActualClave) { errores.push(`Línea ${nLinea}: ${c} no es un mes completo (solo se aceptan meses anteriores al mes en curso).`); continue; }
    if (vistos.has(c)) { errores.push(`Línea ${nLinea}: el mes ${c} está duplicado en el archivo.`); continue; }
    vistos.add(c);
    filas.push([Number(a), Number(m), t, 'csv']);
  }

  if (!cabeceraLeida) throw new AppError(400, 'El CSV no contiene cabecera ni datos.', 'CSV_INVALIDO');
  if (errores.length) {
    const mostrados = errores.slice(0, MAX_ERRORES_REPORTADOS);
    if (errores.length > MAX_ERRORES_REPORTADOS) mostrados.push(`... y ${errores.length - MAX_ERRORES_REPORTADOS} errores más.`);
    throw new AppError(400, `El CSV contiene ${errores.length} error(es). No se importó ningún dato.`, 'CSV_INVALIDO', mostrados);
  }
  if (!filas.length) throw new AppError(400, 'El CSV no contiene filas de datos.', 'CSV_INVALIDO');
  return filas;
}

async function importarCsv(texto) {
  const actual = await mesActual();
  const filas = parsearCsv(texto, actual);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO historial_ventas_mensuales (anio, mes, total_venta_mes, origen) VALUES ?
       ON DUPLICATE KEY UPDATE total_venta_mes = VALUES(total_venta_mes), origen = VALUES(origen)`,
      [filas],
    );
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* noop */ }
    throw err;
  } finally {
    conn.release();
  }
  const serie = await obtenerSerie();
  return { filas_importadas: filas.length, meses_en_serie: serie.serie.length, solapados_prevalece_sistema: serie.fuentes.solapados_prevalece_sistema };
}

module.exports = { obtenerSerie, importarCsv, parsearCsv, MAX_FILAS_CSV };
