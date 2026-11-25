import { api } from './api.js';
import { $, $$, esc, soles, entero, estado, toast, chipVar, mesCorto, fechaHora, rangoPreset, OPC_RANGO, UMBRAL_STOCK_BAJO } from './interfaz.js';
import { ico } from './iconos.js';
import { zapatilla } from './zapatillas.js';
import { barrasMensuales, barrasTop, lineasTop, dona, spark, COLORES_DONA } from './graficos.js';

let ticket = 0;
const F = { preset: '30d', desde: '', hasta: '' };

function html() {
  return `
  <div class="pagehead"><div><h1>Dashboard</h1><p>Resumen general de tu tienda en tiempo real</p></div>
    <div class="daterange no-print">
      <select class="input" id="dPreset" aria-label="Periodo">${OPC_RANGO.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
      <span id="dCustom" hidden class="daterange"><input class="input" type="date" id="dDesde" aria-label="Desde"><input class="input" type="date" id="dHasta" aria-label="Hasta"><button class="btn dark sm" id="dAplicar">Aplicar</button></span>
    </div></div>
  <div id="dEstado" class="estado" hidden></div>
  <div id="dCuerpo">
    <section class="grid g4" id="kpis"></section>
    <section class="dash-mid mt">
      <div class="card"><div class="card-title">${ico('chart')}<span id="tMensual">Ventas mensuales</span>
        <div class="legend"><span><i style="background:#eadfce"></i>Ventas (S/)</span><span><i style="background:#8c8f9a"></i>Unidades</span></div></div>
        <div class="chartbox"><canvas id="cMensual" role="img" aria-label="Ventas mensuales en soles y unidades"></canvas></div></div>
      <div class="card"><div class="card-title">${ico('box')}Productos más vendidos</div><ul class="toplist" id="topList"></ul>
        <p class="note" id="topNota"></p></div>
      <div class="card store" id="tienda"></div>
    </section>
    <section class="grid g2 mt">
      <div class="card"><div class="card-title">${ico('chart')}Comparativo Top 5 (unidades vendidas)</div><div class="chartbox sm"><canvas id="cTop" role="img" aria-label="Unidades vendidas de los 5 productos más vendidos"></canvas></div></div>
      <div class="card"><div class="card-title">${ico('trend')}Ventas mensuales del Top 5</div><div class="chartbox sm"><canvas id="cSeries" role="img" aria-label="Unidades vendidas por mes de cada producto del Top 5"></canvas></div><p class="note" id="serieNota"></p></div>
    </section>
    <section class="dash-bot mt">
      <div class="card"><div class="card-title">${ico('clock')}Actividad reciente</div><ul class="activity" id="actividad"></ul></div>
      <div class="card"><div class="card-title">${ico('grid')}Resumen de ventas por categoría</div><div class="donut"><div class="chartbox"><canvas id="cDona" role="img" aria-label="Distribución de ventas por categoría"></canvas></div><ul id="leyDona"></ul></div></div>
      <div class="card" id="modelo"></div>
    </section>
  </div>`;
}

const rango = () => ({ desde: F.desde, hasta: F.hasta });

function kpi(icono, etiqueta, valor, extra, serie, id) {
  return `<div class="card kpi">${ico(icono)}<div><div class="lbl">${etiqueta}</div><div class="val">${valor}</div>${extra}</div>${serie ? `<div class="sparkwrap"><canvas id="${id}" aria-hidden="true"></canvas></div>` : ''}</div>`;
}

async function cargar() {
  const mi = ++ticket;
  if (F.desde && F.hasta && F.desde > F.hasta) { estado($('#dEstado'), 'error', 'La fecha «Desde» no puede ser posterior a «Hasta».'); return; }
  estado($('#dEstado'), 'cargando', 'Cargando datos del dashboard…');
  try {
    const [res, mens, series, cats, stock, tend, act] = await Promise.all([
      api.resumen(rango()), api.ventasMensualesTotales(rango()), api.mensualTop5(rango()), api.categoriasVentas(rango()),
      api.stockBajo(UMBRAL_STOCK_BAJO), api.tendencias(), api.actividad(),
    ]);
    if (mi !== ticket) return;
    const r = res.data; const t = tend.data;
    if (!r.top_5.length) {
      $('#dCuerpo').hidden = true;
      estado($('#dEstado'), 'vacio', 'No hay ventas completadas en el periodo seleccionado. Prueba con otro rango de fechas.');
      return;
    }
    $('#dCuerpo').hidden = false; estado($('#dEstado'), null);

    const m = mens.data;
    const ticketProm = r.numero_ventas ? r.ventas_totales / r.numero_ventas : null;
    $('#kpis').innerHTML =
      kpi('bag', 'Ventas totales', soles(r.ventas_totales), `<div class="sub">sin IGV · ${chipVar(t.variacion_pct.importe)}</div>`, m.importe.length > 1, 'sp1') +
      kpi('box', 'Productos vendidos', entero(r.unidades_vendidas), `<div class="sub">unidades · ${chipVar(t.variacion_pct.unidades)}</div>`, m.unidades.length > 1, 'sp2') +
      kpi('mail', 'Ventas registradas', entero(r.numero_ventas), `<div class="sub">${r.productos_registrados} productos en catálogo · ${chipVar(t.variacion_pct.ventas)}</div>`, m.importe.length > 1, 'sp3') +
      kpi('chart', 'Ticket promedio', ticketProm === null ? '—' : soles(ticketProm), '<div class="sub">por venta, sin IGV</div>', m.importe.length > 1, 'sp4');
    $$('.kpi .sub').forEach((s) => { if (s.textContent.includes('%')) s.title = t.criterio; });
    spark($('#sp1'), m.importe); spark($('#sp2'), m.unidades); spark($('#sp3'), m.unidades); spark($('#sp4'), m.importe);

    $('#tMensual').textContent = `Ventas por mes (${m.meses.length} ${m.meses.length === 1 ? 'mes' : 'meses'})`;
    barrasMensuales('cMensual', m.meses.map((_, i) => ({ importe: m.importe[i], unidades: m.unidades[i] })), m.meses.map((x) => x.etiqueta));

    $('#topList').innerHTML = r.top_5.map((p) => `<li><div class="thumb">${zapatilla(p.id)}</div><div><b>${esc(p.nombre)}</b><small>${entero(p.unidades_vendidas)} unidades · ${soles(p.importe_facturado)}</small></div></li>`).join('');
    $('#topNota').textContent = F.desde || F.hasta ? 'Por unidades vendidas dentro del periodo filtrado.' : 'Por unidades vendidas en todo el historial.';
    barrasTop('cTop', r.top_5);
    lineasTop('cSeries', series.data);
    $('#serieNota').textContent = series.data.criterio;

    const s = stock.data;
    $('#tienda').innerHTML = `<div class="card-title" style="justify-content:center">${ico(s.total ? 'info' : 'checkc')}Estado del inventario</div>
      <div class="st">${s.total ? `${s.total} con stock bajo` : 'Todo en orden'}</div><small>${s.total ? esc(s.productos.slice(0, 2).map((p) => p.nombre).join(', ')) : `Ningún producto con ${UMBRAL_STOCK_BAJO} unidades o menos`}</small>${zapatilla('AND-RUN-001')}`;

    $('#actividad').innerHTML = act.data.map((a) => {
      const venta = a.tipo === 'venta';
      return `<li>${ico(venta ? 'cart' : 'trend')}<span>${venta ? `Venta V-${String(a.ref).padStart(5, '0')}` : `Predicción de ${esc(mesCorto(a.estado))}`} · ${soles(a.monto)}</span><span class="t">${esc(fechaHora(a.fecha).slice(0, 5))} ${esc(fechaHora(a.fecha).slice(11))}</span>${venta ? `<span class="pill ${a.estado === 'anulada' ? 'off' : ''}">${a.estado === 'anulada' ? 'Anulada' : 'Completada'}</span>` : ''}</li>`;
    }).join('') || '<li class="note">Aún no hay actividad.</li>';

    const c = cats.data; const tot = c.reduce((a, x) => a + x.importe, 0) || 1;
    dona('cDona', c);
    $('#leyDona').innerHTML = c.slice(0, 8).map((x, i) => `<li><i style="background:${COLORES_DONA[i % 8]}"></i>${esc(x.categoria)}<b>${(x.importe / tot * 100).toFixed(1).replace('.', ',')}%</b></li>`).join('');
  } catch (err) {
    if (mi !== ticket) return;
    estado($('#dEstado'), 'error', `No se pudieron cargar los datos: ${err.message}`);
    toast(err.message, 'error');
  }
  cargarModelo(mi);
}

async function cargarModelo(mi) {
  const cont = $('#modelo');
  const base = `<div class="card-title">${ico('trend')}Rendimiento del modelo</div>`;
  try {
    const r = (await api.predMetricas()).data;
    if (mi !== ticket) return;
    const mape = r.metricas.prueba.mape;
    cont.innerHTML = `${base}<div class="bigpct">${mape === null ? '—' : (100 - mape).toFixed(1).replace('.', ',') + '%'}</div>
      <p>Precisión aprox. (100 − MAPE de prueba)</p><p class="note">MAPE ${mape === null ? 'no disponible' : mape.toString().replace('.', ',') + '%'} · RMSE ${soles(r.metricas.prueba.rmse)}</p>
      <p style="margin-top:10px"><span class="pill ${r.evaluacion_limitada ? 'warn' : 'ok'} dot">${r.evaluacion_limitada ? 'Evaluación limitada' : 'Modelo entrenado'}</span></p>`;
  } catch (_) {
    cont.innerHTML = `${base}<p class="note">Todavía no hay un modelo entrenado. Entrénalo en la pantalla Predicción (administrador o analista).</p>`;
  }
}

export async function montar(cont) {
  cont.innerHTML = html();
  const sel = $('#dPreset');
  sel.value = F.preset;
  const r0 = F.preset === 'custom' ? { desde: F.desde, hasta: F.hasta } : rangoPreset(F.preset);
  F.desde = r0.desde; F.hasta = r0.hasta;
  $('#dCustom').hidden = F.preset !== 'custom';
  $('#dDesde').value = F.desde; $('#dHasta').value = F.hasta;
  sel.addEventListener('change', () => {
    F.preset = sel.value;
    $('#dCustom').hidden = F.preset !== 'custom';
    if (F.preset !== 'custom') { Object.assign(F, rangoPreset(F.preset)); cargar(); }
  });
  $('#dAplicar').addEventListener('click', () => { F.desde = $('#dDesde').value; F.hasta = $('#dHasta').value; cargar(); });
  await cargar();
}
