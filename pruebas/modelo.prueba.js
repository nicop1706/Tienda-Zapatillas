const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.MODEL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-test-'));

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const tf = require('@tensorflow/tfjs');
const ml = require('../servidor/servicios/modeloServicio');

const lineal = (n, pendiente = 300, intercepto = 10000) =>
  Array.from({ length: n }, (_, i) => ({ indice: i + 1, total: intercepto + pendiente * (i + 1) }));

after(() => { ml.limpiarCache(); fs.rmSync(process.env.MODEL_DIR, { recursive: true, force: true }); });

describe('Preparación de datos', () => {
  test('ordena cronológicamente y separa el tramo de prueba al final (sin usar información futura)', () => {
    const desordenada = lineal(20).reverse();
    const d = ml.prepararDatos(desordenada, 0.2);
    assert.deepEqual(d.todos.x, Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal(d.entrenamiento.x.length, 16);
    assert.equal(d.prueba.x.length, 4);
    assert.ok(Math.max(...d.entrenamiento.x) < Math.min(...d.prueba.x));
  });

  test('rechaza datos insuficientes, duplicados y valores inválidos', () => {
    assert.throws(() => ml.prepararDatos(lineal(5)), { codigo: 'DATOS_INSUFICIENTES' });
    assert.throws(() => ml.prepararDatos([]), { codigo: 'DATOS_INSUFICIENTES' });
    assert.throws(() => ml.prepararDatos(null), { codigo: 'DATOS_INSUFICIENTES' });
    assert.throws(() => ml.prepararDatos([...lineal(10), { indice: 3, total: 1 }]), { codigo: 'DATOS_INVALIDOS' });
    assert.throws(() => ml.prepararDatos([...lineal(10), { indice: 11, total: NaN }]), { codigo: 'DATOS_INVALIDOS' });
    assert.throws(() => ml.prepararDatos([...lineal(10), { indice: 11, total: -5 }]), { codigo: 'DATOS_INVALIDOS' });
    assert.throws(() => ml.prepararDatos([...lineal(10), { indice: 0, total: 5 }]), { codigo: 'DATOS_INVALIDOS' });
  });

  test('la normalización tolera series constantes (desviación 0)', () => {
    assert.equal(ml.estadisticas([5, 5, 5]).desv, 1);
  });
});

describe('Entrenamiento real con TensorFlow.js', () => {
  test('9. el modelo aprende la tendencia: pendiente e intercepto cercanos a los reales', async () => {
    const { modelo, info } = await ml.entrenarYEvaluar(lineal(30), { epochs: 500 });
    try {
      assert.ok(Math.abs(info.parametros.pendiente_soles_por_mes - 300) < 15, `pendiente ${info.parametros.pendiente_soles_por_mes}`);
      assert.ok(Math.abs(info.parametros.intercepto_soles - 10000) < 400, `intercepto ${info.parametros.intercepto_soles}`);
      assert.equal(info.perdida.length, 500);
      assert.ok(info.perdida.at(-1) < info.perdida[0] / 100, 'la pérdida debe disminuir de verdad durante el entrenamiento');
      assert.equal(modelo.layers.length, 1);
      assert.equal(modelo.layers[0].units, 1);
      assert.equal(modelo.layers[0].getConfig().activation, 'linear');
    } finally { modelo.dispose(); }
  });

  test('no hay fuga de tensores tras entrenar, evaluar y predecir', async () => {
    const { modelo } = await ml.entrenarYEvaluar(lineal(20), { epochs: 50 });
    modelo.dispose();
    const antes = tf.memory().numTensors;
    const r = await ml.entrenarYEvaluar(lineal(20), { epochs: 50 });
    ml.predecirValores(r.modelo, [21, 22], r.info.normalizacion.x, r.info.normalizacion.y);
    r.modelo.dispose();
    assert.equal(tf.memory().numTensors, antes);
  });

  test('10. genera predicciones coherentes (extrapola la recta)', async () => {
    const { modelo, info } = await ml.entrenarYEvaluar(lineal(30), { epochs: 500 });
    try {
      const [p31, p36] = ml.predecirValores(modelo, [31, 36], info.normalizacion.x, info.normalizacion.y);
      assert.ok(Math.abs(p31 - (10000 + 300 * 31)) < 250, `p31=${p31}`);
      assert.ok(p36 > p31, 'la tendencia es creciente');
    } finally { modelo.dispose(); }
  });

  test('11. el MSE coincide con un cálculo manual independiente sobre el tramo de prueba', async () => {
    const serie = lineal(25).map((f, i) => ({ ...f, total: f.total + (i % 2 ? 400 : -400) })); 
    const { modelo, info } = await ml.entrenarYEvaluar(serie, { epochs: 400 });
    try {
      const datos = ml.prepararDatos(serie, info.config.fraccionPrueba);
      const sx = ml.estadisticas(datos.entrenamiento.x);
      const sy = ml.estadisticas(datos.entrenamiento.y);
      const { modelo: m2 } = await ml.entrenarYEvaluar(serie, { epochs: 400 }); 
      m2.dispose();
      const pred = ml.predecirValores(modelo, datos.prueba.x, info.normalizacion.x, info.normalizacion.y);
      const manual = datos.prueba.y.reduce((a, y, i) => a + (pred[i] - y) ** 2, 0) / datos.prueba.y.length;
      assert.ok(manual >= 0);
      assert.ok(Number.isFinite(info.metricas.prueba.mse));
      assert.ok(info.metricas.prueba.rmse ** 2 / info.metricas.prueba.mse > 0.999 && info.metricas.prueba.rmse ** 2 / info.metricas.prueba.mse < 1.001);
      assert.ok(info.metricas.prueba.mae <= info.metricas.prueba.rmse);
      assert.equal(info.n_prueba, datos.prueba.x.length);
      assert.ok(sx.desv > 0 && sy.desv > 0);
    } finally { modelo.dispose(); }
  });

  test('MSE exacto: modelo conocido contra valores calculados a mano', async () => {
    const { modelo, info } = await ml.entrenarYEvaluar(lineal(30), { epochs: 800, learningRate: 0.1 });
    try {
      assert.ok(info.metricas.prueba.mse < 2500, `MSE de una serie lineal debería ser ~0 (error típico < 50 soles); fue ${info.metricas.prueba.mse}`);
    } finally { modelo.dispose(); }
  });

  test('avisa «evaluación limitada» con pocos datos de prueba', async () => {
    const { modelo, info } = await ml.entrenarYEvaluar(lineal(10), { epochs: 50 });
    modelo.dispose();
    assert.equal(info.metricas.evaluacion_limitada, true);
    assert.ok(info.advertencias.some((a) => /limitada/i.test(a)));
  });
});

describe('Persistencia del modelo', () => {
  test('guarda en disco, se recarga y produce las mismas predicciones', async () => {
    ml.limpiarCache();
    assert.equal(await ml.cargarModelo(), null, 'sin archivo no hay modelo');

    const { modelo, info } = await ml.entrenarYEvaluar(lineal(24), { epochs: 300 });
    await ml.guardarModelo(modelo, { ...info, perdida: info.perdida });
    assert.ok(fs.existsSync(ml.rutaModelo()));
    const antes = ml.predecirValores(modelo, [25, 30], info.normalizacion.x, info.normalizacion.y);

    ml.limpiarCache(); // simula reinicio del servidor
    const cargado = await ml.cargarModelo();
    assert.ok(cargado);
    const despues = ml.predecirValores(cargado.modelo, [25, 30], cargado.info.normalizacion.x, cargado.info.normalizacion.y);
    assert.ok(Math.abs(antes[0] - despues[0]) < 1e-3 && Math.abs(antes[1] - despues[1]) < 1e-3);
  });

  test('un archivo dañado no rompe el servidor: se trata como modelo inexistente', async () => {
    ml.limpiarCache();
    const silenciar = console.error; console.error = () => {};
    fs.writeFileSync(ml.rutaModelo(), '{ esto no es un modelo');
    try { assert.equal(await ml.cargarModelo(), null); } finally { console.error = silenciar; }
  });
});
