import { api, ApiError } from './api.js';
import { $, esc, soles, entero, decimal, estado, toast, chipVar, mesCorto, fechaHora, dialogo } from './interfaz.js';
import { ico } from './iconos.js';
import { zapatilla } from './zapatillas.js';
import { prediccion } from './graficos.js';

const MAX_CSV = 200 * 1024;
const S = { serie: [], metricas: null, forecast: null, ctx: null };
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

function html(puedeOperar) {
  return `
  <div class="pagehead"><div><h1>Predicción de Ventas</h1><p>Analiza y pronostica tus ventas futuras con Machine Learning</p></div>
    <div class="actions no-print">${puedeOperar ? `<button class="btn" id="pImportar">${ico('doc')} Importar CSV</button>` : ''}<button class="btn dark" id="pPdf">${ico('download')} Exportar PDF</button></div></div>
  <div id="pEstado" class="estado" hidden></div>
  <section class="grid g4" id="pKpis"></section>
  <section class="split mt" style="grid-template-columns:minmax(0,1fr) 380px">
    <div class="card"><div class="card-title">${ico('chart')}Gráfico de predicción<div class="legend"><span><i style="background:#8c8f9a"></i>Ventas reales</span><span><i style="background:#c9a97d"></i>Ventas predichas</span></div></div>
      <div class="chartbox" style="height:340px"><canvas id="cPred" role="img" aria-label="Ventas mensuales reales y estimadas"></canvas></div><p class="note" id="pNotaBanda"></p></div>
    <div class="card"><div class="card-title">${ico('cal')}Configurar predicción</div>
      <div class="field"><label for="pPeriodo">Selecciona el periodo:</label><select class="input" id="pPeriodo"></select></div>
      <div class="predbox" id="pResultado"><div class="lab">${ico('trend')}Ventas predichas</div><div class="big">—</div><small class="note">Pulsa «Predecir ventas» para calcular la estimación.</small></div>
      <div class="stack"><button class="btn dark block" id="pPredecir">${ico('play')} Predecir ventas</button>
      ${puedeOperar ? `<button class="btn block" id="pEntrenar">${ico('refresh')} Entrenar modelo</button>` : ''}</div>
      <ul class="note" id="pAdv" style="padding-left:18px"></ul></div>
  </section>
  <section class="grid mt" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="card"><div class="card-title">${ico('doc')}Métricas del modelo (tramo de prueba)</div><div id="pMetricas"></div></div>
    <div class="card"><div class="card-title">${ico('bulb')}Estado del entrenamiento</div><div id="pModelo"></div></div>
    <div class="card"><div class="card-title">${ico('doc')}Historial de predicciones</div><div class="tablewrap"><table class="t"><thead><tr><th>Fecha</th><th>Periodo</th><th class="num">Ventas predichas</th></tr></thead><tbody id="pLog"></tbody></table></div></div>
  </section>
  <section class="card mt"><div class="card-title">${ico('table')}Pronóstico de los próximos meses</div><div class="tablewrap"><table class="t"><thead><tr><th>Periodo</th><th class="num">Estimación</th><th class="num">Mínimo orientativo</th><th class="num">Máximo orientativo</th></tr></thead><tbody id="pFore"></tbody></table></div>
    <p class="note" id="pNotaFore"></p></section>
  <div class="aviso mt">${ico('info')}<span><b>Esto es una estimación, no una garantía.</b> El modelo es una regresión lineal simple (TensorFlow.js) sobre las ventas mensuales sin IGV; no considera promociones, estacionalidad ni eventos externos. Los meses incompletos no se usan para entrenar.</span></div>`;
}

function pintarKpis() {
  const m = S.metricas; const f = S.forecast; const ult = S.serie[S.serie.length - 1];
  const mape = m ? m.metricas.prueba.mape : null;
  const precision = mape === null || mape === undefined ? null : Math.max(0, 100 - mape);
  const nivel = precision === null ? '' : precision >= 90 ? ['Muy bueno', 'ok'] : precision >= 80 ? ['Aceptable', 'warn'] : ['Baja', 'off'];
  $('#pKpis').innerHTML = `
    <div class="card kpi">${ico('chart')}<div><div class="lbl">Ventas pronosticadas<br>(próximo periodo)</div><div class="val">${f ? soles(f.filas[0].estimacion) : '—'}</div>${f && ult ? chipVar(pct(f.filas[0].estimacion, ult.total_venta_mes)) : '<span class="sub">Entrena el modelo</span>'}</div></div>
    <div class="card kpi">${ico('cal')}<div><div class="lbl">Período analizado</div><div class="val">${S.serie.length} meses</div><div class="sub">${ult ? `Datos hasta ${esc(ult.etiqueta)}` : 'Sin datos'}</div></div></div>
    <div class="card kpi">${ico('target')}<div><div class="lbl">Precisión del modelo</div><div class="val">${precision === null ? '—' : precision.toFixed(1).replace('.', ',') + '%'}</div>${nivel ? `<span class="pill ${nivel[1]}">${nivel[0]}</span>` : '<span class="sub">Sin evaluar</span>'}<div class="note" style="margin:4px 0 0">100 − MAPE de prueba</div></div></div>
    <div class="card kpi">${ico('trend')}<div><div class="lbl">Método</div><div class="val" style="font-size:22px">Regresión Lineal</div><div class="sub">TensorFlow.js</div></div></div>`;
}

function pintarGrafico(hastaPeriodo) {
  const hist = S.serie.slice(-24);
  const etiquetas = hist.map((h) => mesCorto(h.clave));
  const reales = hist.map((h) => h.total_venta_mes);
  const estimadas = hist.map(() => null); const min = hist.map(() => null); const max = hist.map(() => null);
  if (S.forecast) {
    const ultimoIdx = hist.length - 1;
    estimadas[ultimoIdx] = reales[ultimoIdx]; min[ultimoIdx] = reales[ultimoIdx]; max[ultimoIdx] = reales[ultimoIdx];
    for (const f of S.forecast.filas) {
      etiquetas.push(mesCorto(f.periodo)); reales.push(null);
      estimadas.push(f.estimacion); min.push(f.minimo); max.push(f.maximo);
      if (f.periodo === hastaPeriodo) break;
    }
  }
  prediccion('cPred', { etiquetas, reales, estimadas, banda: S.forecast ? { min, max } : null });
  $('#pNotaBanda').textContent = S.forecast ? S.forecast.nota_banda : 'Entrena el modelo para ver la proyección.';
}

function pintarModelo() {
  const m = S.metricas; const f = S.forecast;
  if (!m) {
    $('#pMetricas').innerHTML = '<p class="note">Aún no hay métricas: el modelo no está entrenado.</p>';
    $('#pModelo').innerHTML = `<div class="okbox warn">${ico('info')}<span>El modelo todavía no está entrenado. Pulsa «Entrenar modelo».</span></div>`;
    return;
  }
  const p = m.metricas.prueba;
  $('#pMetricas').innerHTML = `<div class="metrics"><div><small>MSE</small><b>${entero(p.mse)}</b></div><div><small>MAE</small><b>${decimal(p.mae)}</b></div><div><small>RMSE</small><b>${decimal(p.rmse)}</b></div></div>
    <p class="note">MAE y RMSE en soles; MSE en soles². MAPE ${p.mape === null ? '—' : decimal(p.mape) + '%'}. Evaluado con ${p.n} meses no usados al entrenar. ${m.mejora_vs_promedio_pct !== undefined ? `Error ${decimal(m.mejora_vs_promedio_pct)}% menor que predecir siempre el promedio.` : ''}</p>`;
  const viejo = f && f.modelo.desactualizado;
  $('#pModelo').innerHTML = `<div class="okbox ${viejo || m.evaluacion_limitada ? 'warn' : ''}">${ico(viejo || m.evaluacion_limitada ? 'info' : 'checkc')}<span>${viejo ? 'Los datos cambiaron desde el último entrenamiento. Reentrena el modelo.' : m.evaluacion_limitada ? 'Modelo entrenado, con evaluación limitada por pocos meses de prueba.' : 'El modelo ha sido entrenado correctamente.'}</span></div>
    <p class="note">Entrenado: ${esc(fechaHora(m.entrenado_en.replace('T', ' ')))} (UTC) · ${m.n_observaciones} meses (${mesCorto(m.primer_mes)} a ${mesCorto(m.ultimo_mes)}).</p>
    ${(m.advertencias || []).map((a) => `<p class="note">⚠ ${esc(a)}</p>`).join('')}`;
}

async function cargarTodo() {
  estado($('#pEstado'), 'cargando', 'Cargando datos del modelo…');
  try {
    S.serie = (await api.predHistorial()).data.serie;
    S.metricas = null; S.forecast = null;
    try { S.metricas = (await api.predMetricas()).data; S.forecast = (await api.predPronostico(6)).data; } catch (e) { if (!(e instanceof ApiError) || e.codigo !== 'MODELO_NO_ENTRENADO') throw e; }
    estado($('#pEstado'), S.serie.length < 3 ? 'error' : null, 'Hay muy pocos meses de historial para entrenar. Registra ventas o importa un CSV.');
    pintarKpis(); pintarModelo(); pintarGrafico(null);
    $('#pPeriodo').innerHTML = S.forecast ? S.forecast.filas.map((f) => `<option value="${f.periodo}">${esc(f.etiqueta)}</option>`).join('') : '<option value="">(entrena el modelo primero)</option>';
    $('#pFore').innerHTML = S.forecast ? S.forecast.filas.map((f) => `<tr><td>${esc(f.etiqueta)}</td><td class="num"><b>${soles(f.estimacion)}</b></td><td class="num">${soles(f.minimo)}</td><td class="num">${soles(f.maximo)}</td></tr>`).join('') : '<tr><td colspan="4" class="note">Sin pronóstico: el modelo no está entrenado.</td></tr>';
    $('#pNotaFore').textContent = S.forecast ? S.forecast.nota_banda : '';
    await cargarLog();
  } catch (e) { estado($('#pEstado'), 'error', `No se pudo cargar la pantalla: ${e.message}`); }
}

async function cargarLog() {
  try {
    const r = (await api.predRegistro()).data;
    $('#pLog').innerHTML = r.slice(0, 6).map((x) => `<tr><td>${esc(fechaHora(x.creado_en))}</td><td>${esc(x.etiqueta_periodo)}</td><td class="num">${soles(x.estimacion)}</td></tr>`).join('') || '<tr><td colspan="3" class="note">Aún no has realizado predicciones.</td></tr>';
  } catch (_) { /* no crítico */ }
}

async function predecir() {
  const periodo = $('#pPeriodo').value;
  if (!periodo) { estado($('#pEstado'), 'error', 'Entrena el modelo y selecciona el periodo que deseas predecir.'); return; }
  const btn = $('#pPredecir'); btn.disabled = true;
  try {
    const d = (await api.predPredecir(periodo)).data;
    estado($('#pEstado'), null);
    const ult = S.serie[S.serie.length - 1];
    $('#pResultado').innerHTML = `<div class="lab">${ico('trend')}Ventas predichas · ${esc(d.etiqueta_periodo)}</div><div class="big">${soles(d.estimacion)}</div>${ult ? chipVar(pct(d.estimacion, ult.total_venta_mes)) + `<div class="note">vs ${esc(ult.etiqueta)} (último mes real)</div>` : ''}`;
    $('#pAdv').innerHTML = d.advertencias.map((a) => `<li>${esc(a)}</li>`).join('');
    pintarGrafico(periodo);
    cargarLog();
  } catch (e) { estado($('#pEstado'), 'error', e.message); }
  finally { btn.disabled = false; }
}

async function entrenar() {
  const btn = $('#pEntrenar'); btn.disabled = true;
  estado($('#pEstado'), 'cargando', 'Entrenando el modelo con TensorFlow.js… puede tardar unos segundos.');
  try {
    await api.predEntrenar({});
    toast('Modelo entrenado correctamente.', 'exito');
    $('#pResultado').innerHTML = `<div class="lab">${ico('trend')}Ventas predichas</div><div class="big">—</div><small class="note">Pulsa «Predecir ventas».</small>`;
    await cargarTodo();
  } catch (e) { estado($('#pEstado'), 'error', e.message, Array.isArray(e.detalles) ? e.detalles : undefined); }
  finally { btn.disabled = false; }
}

function importar() {
  const d = dialogo(`<h2>Importar historial (CSV)</h2>
    <p class="note">Columnas: <code>anio,numero_mes,total_venta_mes</code> (soles sin IGV). Máximo 200 KB. Si un mes ya existe en las ventas del sistema, prevalece la venta del sistema; si ya fue importado antes, se actualiza.</p>
    <div class="field mt"><label for="pCsv">Archivo .csv</label><input class="input" type="file" id="pCsv" accept=".csv,text/csv" style="padding-top:9px"></div>
    <div id="pImpEstado" class="estado" hidden></div>
    <div class="foot"><button class="btn" data-cerrar>Cerrar</button><button class="btn dark" id="pImpOk">Importar</button></div>`);
  $('#pImpOk').onclick = async () => {
    const cont = $('#pImpEstado'); const f = $('#pCsv').files[0];
    if (!f) return estado(cont, 'error', 'Selecciona primero un archivo CSV.');
    if (f.size > MAX_CSV) return estado(cont, 'error', 'El archivo supera el máximo de 200 KB.');
    if (!/\.csv$/i.test(f.name)) return estado(cont, 'error', 'El archivo debe tener extensión .csv.');
    estado(cont, 'cargando', 'Validando e importando…');
    try {
      const r = (await api.predImportar(await f.text())).data;
      estado(cont, 'exito', `Se importaron ${r.filas_importadas} mes(es). La serie tiene ${r.meses_en_serie} meses${r.solapados_prevalece_sistema ? ` (${r.solapados_prevalece_sistema} coinciden con ventas del sistema, que prevalecen)` : ''}. Reentrena el modelo para usar los datos nuevos.`);
      cargarTodo();
    } catch (e) { estado(cont, 'error', e.message, e instanceof ApiError && Array.isArray(e.detalles) ? e.detalles : undefined); }
  };
  return d;
}

export async function montar(cont, { puede }) {
  const op = puede('administrador', 'analista');
  cont.innerHTML = html(op);
  $('#pPdf').onclick = () => window.print();
  $('#pPredecir').onclick = predecir;
  if (op) { $('#pEntrenar').onclick = entrenar; $('#pImportar').onclick = importar; }
  await cargarTodo();
}
