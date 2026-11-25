const ml = require('./modeloServicio');
const { pool } = require('../configuracion/baseDatos');
const historial = require('./historialServicio');
const { AppError } = require('../utilidades/errores');
const { mesAbsoluto, parseClave, sumarMeses, etiquetaCorta, etiquetaLarga, rangoMeses } = require('../utilidades/fechas');

const MESES_OPCIONES = 12;   
const MESES_MAXIMOS = 24;    
const AVISO_ESTIMACION =
  'Esta cifra es una estimación estadística basada en la tendencia lineal del historial. ' +
  'No es una garantía de ventas futuras.';
const LIMITACIONES = [
  'Regresión Lineal Simple: solo modela una tendencia recta; no captura estacionalidad (por ejemplo, picos de diciembre).',
  'La variable de entrada es el índice cronológico del mes (1, 2, 3, …), no el número de mes del año (1–12): ' +
    'así enero de años distintos no se confunde.',
  'Con pocos meses de historia la estimación es poco fiable; el error de prueba solo mide los últimos meses disponibles.',
];

let entrenando = false;

const indiceDeClave = (claveMes, primerMes) => {
  const a = parseClave(claveMes);
  const b = parseClave(primerMes);
  return mesAbsoluto(a.anio, a.mes) - mesAbsoluto(b.anio, b.mes) + 1;
};

function validarConfig(body) {
  const b = body && typeof body === 'object' ? body : {};
  const cfg = {};
  if (b.epochs !== undefined) {
    const n = Number(b.epochs);
    if (!Number.isInteger(n) || n < 10 || n > 5000) throw new AppError(400, '«epochs» debe ser un entero entre 10 y 5000.', 'PARAMETRO_INVALIDO');
    cfg.epochs = n;
  }
  if (b.learning_rate !== undefined) {
    const n = Number(b.learning_rate);
    if (!Number.isFinite(n) || n < 0.0001 || n > 1) throw new AppError(400, '«learning_rate» debe estar entre 0.0001 y 1.', 'PARAMETRO_INVALIDO');
    cfg.learningRate = n;
  }
  if (b.fraccion_prueba !== undefined) {
    const n = Number(b.fraccion_prueba);
    if (!Number.isFinite(n) || n < 0.1 || n > 0.4) throw new AppError(400, '«fraccion_prueba» debe estar entre 0.1 y 0.4.', 'PARAMETRO_INVALIDO');
    cfg.fraccionPrueba = n;
  }
  return cfg;
}

function reducirPerdida(perdida) {
  if (perdida.length <= 200) return perdida.map((v, i) => ({ epoca: i + 1, perdida: v }));
  const paso = Math.ceil(perdida.length / 200);
  const out = [];
  for (let i = 0; i < perdida.length; i += paso) out.push({ epoca: i + 1, perdida: perdida[i] });
  out.push({ epoca: perdida.length, perdida: perdida[perdida.length - 1] });
  return out;
}

function describirModelo(info, hashActual) {
  const { perdida, normalizacion, ...resto } = info;
  return {
    ...resto,
    desactualizado: info.hash_datos !== hashActual,
    curva_perdida: reducirPerdida(perdida || []),
    limitaciones: LIMITACIONES,
  };
}

async function obtenerHistorial() {
  const s = await historial.obtenerSerie();
  const cargado = await ml.cargarModelo();
  const ultimo = cargado ? cargado.info.ultimo_mes : s.ultimoMes;
  const periodos = ultimo
    ? Array.from({ length: MESES_OPCIONES }, (_, i) => {
        const c = sumarMeses(ultimo, i + 1);
        return { valor: c, etiqueta: etiquetaLarga(c) };
      })
    : [];
  return {
    serie: s.serie,
    resumen: {
      n_meses: s.serie.length,
      primer_mes: s.primerMes,
      ultimo_mes: s.ultimoMes,
      mes_en_curso_excluido: s.mesActual,
      meses_faltantes: s.faltantes,
      fuentes: s.fuentes,
      regla_combinacion:
        'Si un mes existe en el CSV importado y en las ventas del sistema, prevalece el sistema. ' +
        'El mes en curso se excluye por estar incompleto. Los meses faltantes no se rellenan.',
    },
    periodos_disponibles: periodos,
    modelo_entrenado: Boolean(cargado),
    modelo_desactualizado: cargado ? cargado.info.hash_datos !== s.hash : false,
  };
}

async function entrenar(body) {
  const cfg = validarConfig(body);
  if (entrenando) throw new AppError(409, 'Ya hay un entrenamiento en curso. Espera a que termine.', 'ENTRENAMIENTO_EN_CURSO');
  entrenando = true;
  try {
    const s = await historial.obtenerSerie();
    const datos = s.serie.map((f) => ({ indice: f.indice, total: f.total_venta_mes }));
    const { modelo, info } = await ml.entrenarYEvaluar(datos, cfg);
    if (s.faltantes.length) {
      info.advertencias.push(`Hay ${s.faltantes.length} mes(es) sin datos entre ${s.primerMes} y ${s.ultimoMes}; no se rellenaron.`);
    }
    const completo = {
      ...info,
      entrenado_en: new Date().toISOString(),
      primer_mes: s.primerMes,
      ultimo_mes: s.ultimoMes,
      hash_datos: s.hash,
      fuentes: s.fuentes,
      meses_faltantes: s.faltantes,
      algoritmo: 'Regresión Lineal Simple (tf.sequential, 1 capa densa, 1 neurona, activación lineal, pérdida MSE, optimizador Adam)',
    };
    await ml.guardarModelo(modelo, completo);
    return describirModelo(completo, s.hash);
  } finally {
    entrenando = false;
  }
}

async function obtenerMetricas() {
  const cargado = await ml.cargarModelo();
  if (!cargado) {
    throw new AppError(404, 'Aún no hay un modelo entrenado. Pulsa «Entrenar modelo» para generarlo.', 'MODELO_NO_ENTRENADO');
  }
  const s = await historial.obtenerSerie();
  return describirModelo(cargado.info, s.hash);
}

async function predecir(body, usuarioId = null) {
  const periodo = body && typeof body.periodo === 'string' ? body.periodo.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
    throw new AppError(400, 'Selecciona un periodo válido con el formato AAAA-MM.', 'PARAMETRO_INVALIDO');
  }
  const cargado = await ml.cargarModelo();
  if (!cargado) {
    throw new AppError(409, 'El modelo aún no está entrenado. Entrénalo antes de solicitar una predicción.', 'MODELO_NO_ENTRENADO');
  }
  const { modelo, info } = cargado;
  const idx = indiceDeClave(periodo, info.primer_mes);
  const idxUltimo = indiceDeClave(info.ultimo_mes, info.primer_mes);
  if (idx <= idxUltimo) {
    throw new AppError(400, `El periodo debe ser posterior al último mes con datos (${etiquetaLarga(info.ultimo_mes)}).`, 'PERIODO_INVALIDO');
  }
  if (idx - idxUltimo > MESES_MAXIMOS) {
    throw new AppError(400, `Solo se permiten predicciones hasta ${MESES_MAXIMOS} meses después del último dato.`, 'PERIODO_INVALIDO');
  }

  const { x: sx, y: sy } = info.normalizacion;
  const [bruto] = ml.predecirValores(modelo, [idx], sx, sy);
  const estimacion = Math.max(0, ml.redondear(bruto));

  const s = await historial.obtenerSerie();
  const ajuste = ml.predecirValores(modelo, s.serie.map((f) => indiceDeClave(f.clave, info.primer_mes)), sx, sy);
  const mesesProy = rangoMeses(sumarMeses(info.ultimo_mes, 1), periodo);
  const proy = ml.predecirValores(modelo, mesesProy.map((c) => indiceDeClave(c, info.primer_mes)), sx, sy);

  const advertencias = [];
  if (info.hash_datos !== s.hash) {
    advertencias.push('Los datos históricos cambiaron desde el último entrenamiento. Reentrena el modelo para incorporarlos.');
  }
  if (bruto < 0) advertencias.push('La tendencia lineal produjo un valor negativo; se muestra 0.');
  if (info.metricas.evaluacion_limitada) advertencias.push(info.advertencias[0]);

  await pool.execute(
    'INSERT INTO historial_predicciones (periodo, estimacion, mse, usuario_id) VALUES (?, ?, ?, ?)',
    [periodo, estimacion, info.metricas.prueba.mse, usuarioId],
  );

  return {
    periodo,
    etiqueta_periodo: etiquetaLarga(periodo),
    moneda: 'PEN',
    estimacion,
    aviso: AVISO_ESTIMACION,
    advertencias,
    modelo: { entrenado_en: info.entrenado_en, desactualizado: info.hash_datos !== s.hash },
    metricas_resumen: { mse: info.metricas.prueba.mse, mae: info.metricas.prueba.mae, rmse: info.metricas.prueba.rmse, mape: info.metricas.prueba.mape ?? null },
    grafico: {
      historico: s.serie.map((f) => ({ clave: f.clave, etiqueta: f.etiqueta, valor: f.total_venta_mes })),
      ajuste: s.serie.map((f, i) => ({ clave: f.clave, etiqueta: f.etiqueta, valor: Math.max(0, ml.redondear(ajuste[i])) })),
      proyeccion: mesesProy.map((c, i) => ({ clave: c, etiqueta: etiquetaCorta(c), valor: Math.max(0, ml.redondear(proy[i])) })),
    },
  };
}

async function pronostico(body) {
  const b = body && typeof body === 'object' ? body : {};
  const n = b.meses === undefined ? 6 : Number(b.meses);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new AppError(400, '«meses» debe ser un entero entre 1 y 12.', 'PARAMETRO_INVALIDO');
  }
  const cargado = await ml.cargarModelo();
  if (!cargado) {
    throw new AppError(409, 'El modelo aún no está entrenado. Entrénalo antes de generar un pronóstico.', 'MODELO_NO_ENTRENADO');
  }
  const { modelo, info } = cargado;
  const { x: sx, y: sy } = info.normalizacion;
  const rmse = info.metricas.prueba.rmse;
  const claves = Array.from({ length: n }, (_, i) => sumarMeses(info.ultimo_mes, i + 1));
  const valores = ml.predecirValores(modelo, claves.map((c) => indiceDeClave(c, info.primer_mes)), sx, sy);

  let acumulado = 0;
  const filas = claves.map((c, i) => {
    const est = Math.max(0, ml.redondear(valores[i]));
    acumulado += est;
    return {
      periodo: c,
      etiqueta: etiquetaLarga(c),
      etiqueta_corta: etiquetaCorta(c),
      estimacion: est,
      minimo: Math.max(0, ml.redondear(valores[i] - rmse)),
      maximo: Math.max(0, ml.redondear(valores[i] + rmse)),
    };
  });
  const s = await historial.obtenerSerie();
  return {
    moneda: 'PEN',
    meses: n,
    margen_rmse: rmse,
    total_estimado: ml.redondear(acumulado),
    filas,
    aviso: AVISO_ESTIMACION,
    nota_banda: 'La banda es la estimación ± el RMSE del tramo de prueba; es orientativa, no un intervalo de confianza estadístico.',
    modelo: { entrenado_en: info.entrenado_en, desactualizado: info.hash_datos !== s.hash },
  };
}

async function registroPredicciones(limite = 20) {
  const [filas] = await pool.query(
    `SELECT h.id, h.creado_en, h.periodo, h.estimacion, h.mse, u.nombre AS usuario
     FROM historial_predicciones h LEFT JOIN usuarios u ON u.id = h.usuario_id
     ORDER BY h.id DESC LIMIT ?`, [limite]);
  return filas.map((f) => ({ ...f, etiqueta_periodo: etiquetaLarga(f.periodo), estimacion: Number(f.estimacion), mse: f.mse === null ? null : Number(f.mse) }));
}

module.exports = { registroPredicciones, pronostico, obtenerHistorial, entrenar, obtenerMetricas, predecir, importarCsv: historial.importarCsv };
