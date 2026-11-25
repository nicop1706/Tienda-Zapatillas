import { api } from './api.js';
import { $, esc, soles, entero, estado, paginador, rangoPreset, OPC_RANGO, mesCorto } from './interfaz.js';
import { ico } from './iconos.js';
import { barrasMensuales, spark } from './graficos.js';

const POR = 8;
const S = { preset: '6m', desde: '', hasta: '', tipo: 'producto', page: 1, datos: null };

function html() {
  return `<div class="pagehead"><div><h1>Reportes</h1><p>Consulta y descarga reportes detallados de tu tienda</p></div></div>
  <form class="card filterbar no-print" id="rForm">
    <div class="field"><label for="rRango">Rango de fechas</label><select class="input" id="rRango">${OPC_RANGO.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
    <div class="field" id="rCustom" hidden><label>Desde / hasta</label><div class="daterange"><input class="input" type="date" id="rDesde" aria-label="Desde"><input class="input" type="date" id="rHasta" aria-label="Hasta"></div></div>
    <div class="field"><label for="rTipo">Tipo de reporte</label><select class="input" id="rTipo"><option value="producto">Ventas por producto</option><option value="categoria">Ventas por categoría</option><option value="mensual">Ventas por mes</option></select></div>
    <button class="btn dark" type="submit" style="margin-left:auto">${ico('chart')} Generar reporte</button></form>
  <div id="rEstado" class="estado" hidden></div>
  <div id="rCuerpo">
  <section class="split mt" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
    <div class="card"><div class="card-title">${ico('chart')}Resumen de ventas<div class="legend"><span><i style="background:#eadfce"></i>Ventas (S/)</span><span><i style="background:#8c8f9a"></i>Unidades</span></div></div><div class="chartbox"><canvas id="cRep" role="img" aria-label="Ventas por mes del periodo"></canvas></div></div>
    <div class="grid g2" id="rKpis" style="align-content:start"></div>
  </section>
  <section class="split mt" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
    <div class="card"><div class="card-title">${ico('doc')}<span id="rTitulo">Reporte detallado</span></div><div class="tablewrap"><table class="t"><thead id="rHead"></thead><tbody id="rBody"></tbody></table></div><div class="pager" id="rPag"></div></div>
    <div class="card no-print"><div class="card-title">${ico('download')}Descargar reporte</div><p class="note" style="margin:0 0 4px">Selecciona el formato de descarga (usa el rango de fechas elegido):</p>
      <div class="dl"><button class="btn" id="rPdf">${ico('doc')} PDF</button><a class="btn" id="rXlsx" href="#" download>${ico('table')} Excel</a><a class="btn" id="rCsv" href="#" download>${ico('table')} CSV</a></div>
      <div class="aviso">${ico('info')}<span>Los reportes se generan con los datos actualizados de tu tienda. Importes netos sin IGV, salvo «Total facturado». Las ventas anuladas no se incluyen.</span></div></div>
  </section></div>`;
}

const rango = () => ({ desde: S.desde, hasta: S.hasta });
function enlaces() {
  const qs = new URLSearchParams(Object.entries(rango()).filter(([, v]) => v)).toString();
  $('#rXlsx').href = '/api/reports/export.xlsx' + (qs ? `?${qs}` : '');
  $('#rCsv').href = '/api/reports/export.csv' + (qs ? `?${qs}` : '');
}

function tabla() {
  const d = S.datos; let cab; let filas;
  if (S.tipo === 'producto') {
    $('#rTitulo').textContent = 'Reporte detallado por producto';
    cab = '<tr><th>Producto</th><th>Categoría</th><th class="num">Unidades</th><th class="num">Importe neto</th></tr>';
    filas = d.por_producto.map((p) => `<tr><td>${esc(p.nombre)}<br><small class="note">${esc(p.sku)}</small></td><td>${esc(p.categoria)}</td><td class="num">${entero(p.unidades)}</td><td class="num">${soles(p.neto)}</td></tr>`);
  } else if (S.tipo === 'categoria') {
    $('#rTitulo').textContent = 'Reporte detallado por categoría';
    cab = '<tr><th>Categoría</th><th class="num">Unidades</th><th class="num">Importe neto</th></tr>';
    filas = d.por_categoria.map((c) => `<tr><td>${esc(c.categoria)}</td><td class="num">${entero(c.unidades)}</td><td class="num">${soles(c.importe)}</td></tr>`);
  } else {
    $('#rTitulo').textContent = 'Reporte detallado por mes';
    cab = '<tr><th>Mes</th><th class="num">Unidades</th><th class="num">Importe neto</th></tr>';
    filas = d.mensual.meses.map((m, i) => `<tr><td>${esc(m.etiqueta)}</td><td class="num">${entero(d.mensual.unidades[i])}</td><td class="num">${soles(d.mensual.importe[i])}</td></tr>`);
  }
  const paginas = Math.max(1, Math.ceil(filas.length / POR));
  if (S.page > paginas) S.page = paginas;
  $('#rHead').innerHTML = cab;
  $('#rBody').innerHTML = filas.slice((S.page - 1) * POR, S.page * POR).join('') || '<tr><td colspan="4" class="note">Sin datos.</td></tr>';
  paginador($('#rPag'), { page: S.page, paginas, total: filas.length, limit: POR }, (n) => { S.page = n; tabla(); }, 'filas');
}

async function generar() {
  if (S.desde && S.hasta && S.desde > S.hasta) { estado($('#rEstado'), 'error', 'La fecha «Desde» no puede ser posterior a «Hasta».'); return; }
  enlaces();
  estado($('#rEstado'), 'cargando', 'Generando reporte…');
  try {
    const d = (await api.reporte(rango())).data;
    S.datos = d;
    if (!d.kpis.ventas) { $('#rCuerpo').hidden = true; estado($('#rEstado'), 'vacio', 'No hay ventas completadas en el periodo seleccionado.'); return; }
    $('#rCuerpo').hidden = false; estado($('#rEstado'), null);
    const k = d.kpis; const m = d.mensual;
    $('#rKpis').innerHTML = [['bag', 'Total facturado', soles(k.total), `Neto ${soles(k.subtotal)} + IGV ${soles(k.igv)}`, 'k1'], ['box', 'Unidades vendidas', entero(k.unidades), `${entero(k.anuladas)} ventas anuladas`, 'k2'],
      ['mail', 'N.º de ventas', entero(k.ventas), 'completadas', 'k3'], ['chart', 'Ticket promedio', k.ticket_promedio === null ? '—' : soles(k.ticket_promedio), 'con IGV', 'k4']]
      .map(([i, l, v, s, id]) => `<div class="card kpi" style="min-height:140px">${ico(i)}<div><div class="lbl">${l}</div><div class="val" style="font-size:22px">${v}</div><div class="sub">${s}</div></div><div class="sparkwrap"><canvas id="${id}" aria-hidden="true"></canvas></div></div>`).join('');
    spark($('#k1'), m.importe); spark($('#k2'), m.unidades); spark($('#k3'), m.unidades); spark($('#k4'), m.importe);
    barrasMensuales('cRep', m.meses.map((_, i) => ({ importe: m.importe[i], unidades: m.unidades[i] })), m.meses.map((x) => x.etiqueta));
    tabla();
  } catch (e) { estado($('#rEstado'), 'error', `No se pudo generar el reporte: ${e.message}`); }
}

export async function montar(cont) {
  cont.innerHTML = html();
  $('#rRango').value = S.preset; $('#rTipo').value = S.tipo;
  const aplicar = () => { if (S.preset !== 'custom') Object.assign(S, rangoPreset(S.preset)); };
  aplicar();
  $('#rCustom').hidden = S.preset !== 'custom';
  $('#rDesde').value = S.desde; $('#rHasta').value = S.hasta;
  $('#rRango').onchange = (e) => { S.preset = e.target.value; $('#rCustom').hidden = S.preset !== 'custom'; };
  $('#rTipo').onchange = (e) => { S.tipo = e.target.value; S.page = 1; if (S.datos) tabla(); };
  $('#rForm').onsubmit = (e) => { e.preventDefault(); if (S.preset === 'custom') { S.desde = $('#rDesde').value; S.hasta = $('#rHasta').value; } else aplicar(); S.page = 1; generar(); };
  $('#rPdf').onclick = () => window.print();
  await generar();
}
