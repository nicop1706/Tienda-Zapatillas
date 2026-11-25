const fs = require('fs/promises');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const { AppError } = require('../utilidades/errores');

const MIN_OBSERVACIONES = 8;       
const MIN_ENTRENAMIENTO = 5;       
const MIN_PRUEBA_FIABLE = 6;     
const NOMBRE_ARCHIVO = 'modelo-ventas.json';

const CONFIG_DEFECTO = Object.freeze({ epochs: 400, learningRate: 0.05, fraccionPrueba: 0.2 });


function estadisticas(valores) {
  const n = valores.length;
  const media = valores.reduce((a, b) => a + b, 0) / n;
  const varianza = valores.reduce((a, b) => a + (b - media) ** 2, 0) / n;
  const desv = Math.sqrt(varianza);
  return { media, desv: desv > 1e-9 ? desv : 1 };
}

/**
 * Valida y divide la serie cronológicamente (sin mezclar): los últimos meses forman el tramo de prueba,
 * de modo que el entrenamiento nunca usa información futura.
 * @param {{indice:number,total:number}[]} serie
 */
function prepararDatos(serie, fraccionPrueba = CONFIG_DEFECTO.fraccionPrueba) {
  if (!Array.isArray(serie)) throw new AppError(422, 'No hay datos históricos disponibles.', 'DATOS_INSUFICIENTES');
  const vistos = new Set();
  for (const f of serie) {
    if (!Number.isInteger(f.indice) || f.indice < 1 || !Number.isFinite(f.total) || f.total < 0) {
      throw new AppError(422, 'Los datos históricos contienen valores no válidos (índice o importe).', 'DATOS_INVALIDOS');
    }
    if (vistos.has(f.indice)) {
      throw new AppError(422, 'Los datos históricos contienen meses duplicados.', 'DATOS_INVALIDOS');
    }
    vistos.add(f.indice);
  }
  const ordenada = [...serie].sort((a, b) => a.indice - b.indice);
  const n = ordenada.length;
  if (n < MIN_OBSERVACIONES) {
    throw new AppError(
      422,
      `Se necesitan al menos ${MIN_OBSERVACIONES} meses completos con ventas para entrenar el modelo (hay ${n}). ` +
        'Importa un CSV histórico o registra más ventas.',
      'DATOS_INSUFICIENTES',
    );
  }
  const nPrueba = Math.max(2, Math.round(n * fraccionPrueba));
  const nEntren = n - nPrueba;
  if (nEntren < MIN_ENTRENAMIENTO) {
    throw new AppError(422, 'No hay suficientes meses para separar entrenamiento y prueba.', 'DATOS_INSUFICIENTES');
  }
  const x = ordenada.map((f) => f.indice);
  const y = ordenada.map((f) => f.total);
  return {
    todos: { x, y },
    entrenamiento: { x: x.slice(0, nEntren), y: y.slice(0, nEntren) },
    prueba: { x: x.slice(nEntren), y: y.slice(nEntren) },
  };
}

function crearModelo(learningRate) {
  const modelo = tf.sequential();
  modelo.add(tf.layers.dense({
    units: 1,
    inputShape: [1],
    activation: 'linear',
    kernelInitializer: 'zeros', 
    biasInitializer: 'zeros',
  }));
  modelo.compile({ optimizer: tf.train.adam(learningRate), loss: 'meanSquaredError' });
  return modelo;
}

const normalizar = (v, st) => (v - st.media) / st.desv;

async function entrenarModelo(x, y, statsX, statsY, { epochs, learningRate }) {
  const modelo = crearModelo(learningRate);
  const xs = tf.tensor2d(x.map((v) => [normalizar(v, statsX)]));
  const ys = tf.tensor2d(y.map((v) => [normalizar(v, statsY)]));
  try {
    const hist = await modelo.fit(xs, ys, { epochs, batchSize: x.length, shuffle: false, verbose: 0 });
    if (modelo.optimizer) modelo.optimizer.dispose();
    return { modelo, perdida: hist.history.loss.map(Number) };
  } catch (err) {
    modelo.dispose();
    throw err;
  } finally {
    xs.dispose();
    ys.dispose();
  }
}

function predecirValores(modelo, indices, statsX, statsY) {
  let salida;
  tf.tidy(() => {
    const xs = tf.tensor2d(indices.map((v) => [normalizar(v, statsX)]));
    const yn = modelo.predict(xs).reshape([-1]);
    salida = Array.from(yn.mul(statsY.desv).add(statsY.media).dataSync());
  });
  return salida;
}

function evaluarModelo(modelo, x, y, statsX, statsY, mediaReferencia = null) {
  let res;
  tf.tidy(() => {
    const xs = tf.tensor2d(x.map((v) => [normalizar(v, statsX)]));
    const real = tf.tensor1d(y);
    const pred = modelo.predict(xs).reshape([-1]).mul(statsY.desv).add(statsY.media);
    const error = pred.sub(real);
    const mse = error.square().mean().dataSync()[0];
    const mae = error.abs().mean().dataSync()[0];
    res = { mse, mae, rmse: Math.sqrt(mse), n: x.length };
    const reales = real.dataSync();
    const errs = error.abs().dataSync();
    let suma = 0; let cuenta = 0;
    for (let i = 0; i < reales.length; i++) if (reales[i] > 0) { suma += errs[i] / reales[i]; cuenta++; }
    res.mape = cuenta ? (suma / cuenta) * 100 : null;
    if (mediaReferencia !== null) {
      res.mse_referencia = real.sub(mediaReferencia).square().mean().dataSync()[0];
    }
  });
  return res;
}

function parametrosOriginales(modelo, statsX, statsY) {
  const [kernel, bias] = modelo.layers[0].getWeights();
  const w = kernel.dataSync()[0];
  const b = bias.dataSync()[0];
  const pendiente = (w * statsY.desv) / statsX.desv;
  const intercepto = b * statsY.desv + statsY.media - pendiente * statsX.media;
  return { w, b, pendiente, intercepto };
}

const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const redondearMetricas = (m) => ({ ...m, mse: redondear(m.mse), mae: redondear(m.mae), rmse: redondear(m.rmse), mape: m.mape === null || m.mape === undefined ? null : redondear(m.mape, 2) });

async function entrenarYEvaluar(serie, configUsuario = {}) {
  const config = { ...CONFIG_DEFECTO, ...configUsuario };
  const datos = prepararDatos(serie, config.fraccionPrueba);

  const sxTr = estadisticas(datos.entrenamiento.x);
  const syTr = estadisticas(datos.entrenamiento.y);
  const { modelo: modeloEval } = await entrenarModelo(datos.entrenamiento.x, datos.entrenamiento.y, sxTr, syTr, config);
  let metricasPrueba;
  let metricasEntren;
  try {
    metricasEntren = evaluarModelo(modeloEval, datos.entrenamiento.x, datos.entrenamiento.y, sxTr, syTr);
    metricasPrueba = evaluarModelo(modeloEval, datos.prueba.x, datos.prueba.y, sxTr, syTr, syTr.media);
  } finally {
    modeloEval.dispose();
  }

  const sx = estadisticas(datos.todos.x);
  const sy = estadisticas(datos.todos.y);
  const { modelo, perdida } = await entrenarModelo(datos.todos.x, datos.todos.y, sx, sy, config);
  const params = parametrosOriginales(modelo, sx, sy);

  const baseline = metricasPrueba.mse_referencia;
  delete metricasPrueba.mse_referencia;
  const limitada = datos.prueba.x.length < MIN_PRUEBA_FIABLE;

  const advertencias = [];
  if (limitada) {
    advertencias.push(`Evaluación limitada: el tramo de prueba tiene solo ${datos.prueba.x.length} meses; el MSE puede no ser representativo.`);
  }

  return {
    modelo,
    info: {
      config,
      n_observaciones: datos.todos.x.length,
      n_entrenamiento: datos.entrenamiento.x.length,
      n_prueba: datos.prueba.x.length,
      normalizacion: { x: sx, y: sy },
      parametros: {
        pendiente_soles_por_mes: redondear(params.pendiente),
        intercepto_soles: redondear(params.intercepto),
        peso_normalizado: params.w,
        sesgo_normalizado: params.b,
      },
      metricas: {
        prueba: redondearMetricas(metricasPrueba),
        entrenamiento: redondearMetricas(metricasEntren),
        mse_referencia_promedio: redondear(baseline),
        mejora_vs_promedio_pct: baseline > 0 ? redondear((1 - metricasPrueba.mse / baseline) * 100, 1) : null,
        perdida_final_normalizada: perdida[perdida.length - 1],
        evaluacion_limitada: limitada,
      },
      perdida,
      advertencias,
    },
  };
}

const dirModelos = () => process.env.MODEL_DIR || path.join(__dirname, '../../modelos');
const rutaModelo = () => path.join(dirModelos(), NOMBRE_ARCHIVO);

let cache = null; // { modelo, info }

async function guardarModelo(modelo, info) {
  await fs.mkdir(dirModelos(), { recursive: true });
  await modelo.save(tf.io.withSaveHandler(async (artefactos) => {
    const payload = {
      formato: 'tfjs-layers-model/v1',
      modelTopology: artefactos.modelTopology,
      weightSpecs: artefactos.weightSpecs,
      pesosBase64: Buffer.from(artefactos.weightData).toString('base64'),
      info,
    };
    const tmp = `${rutaModelo()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload), 'utf8');
    await fs.rename(tmp, rutaModelo());
    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
  }));
  if (cache && cache.modelo !== modelo) cache.modelo.dispose();
  cache = { modelo, info };
}

async function cargarModelo() {
  if (cache) return cache;
  let texto;
  try {
    texto = await fs.readFile(rutaModelo(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const raw = JSON.parse(texto);
    const buf = Buffer.from(raw.pesosBase64, 'base64');
    const weightData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const modelo = await tf.loadLayersModel(tf.io.fromMemory({
      modelTopology: raw.modelTopology, weightSpecs: raw.weightSpecs, weightData,
    }));
    cache = { modelo, info: raw.info };
    return cache;
  } catch (err) {
    console.error('[ml] El archivo del modelo guardado está dañado; será necesario reentrenar.', err.message);
    return null;
  }
}

function limpiarCache() {
  if (cache) cache.modelo.dispose();
  cache = null;
}

module.exports = {
  CONFIG_DEFECTO, MIN_OBSERVACIONES, prepararDatos, estadisticas, entrenarYEvaluar,
  predecirValores, guardarModelo, cargarModelo, limpiarCache, rutaModelo, redondear,
};
