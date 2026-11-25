import { api } from './api.js';
import { $, $$, esc, soles, entero, estado, toast, confirmar, debounce, paginador, fechaHora, numVenta, dialogo, emitirCambio, hoyISO } from './interfaz.js';
import { ico } from './iconos.js';
import { zapatilla } from './zapatillas.js';

const POR = 8;
const IGV = 18;
const H = { page: 1, desde: '', hasta: '', producto_id: '', estado: '' };
const C = { prods: [], sel: null, cant: 1, lineas: [], q: '', puedeVender: false };
let tH = 0;
const c2 = (n) => Math.round(n * 100);                           // soles -> céntimos
const igvDe = (subC) => Math.round((subC * IGV) / 100);

function html() {
  const v = C.puedeVender;
  return `
  <div class="pagehead"><div><h1>Ventas</h1><p>${v ? 'Registra nuevas ventas y consulta el historial de operaciones.' : 'Consulta el historial de operaciones.'}</p></div></div>
  ${v ? `<section class="ventas-top">
    <div class="card"><div class="searchbox" style="margin-bottom:12px">${ico('search')}<label class="sr-only" for="vBuscar">Buscar producto</label><input class="input" id="vBuscar" type="search" placeholder="Buscar producto…"></div><div class="plist" id="vLista"></div></div>
    <div class="card"><div class="card-title">${ico('cart')}Detalle de la venta<span class="pill" style="margin-left:auto" id="vFecha"></span></div>
      <div id="vDetalle"></div>
      <div class="lineas" id="vLineas"></div>
      <div class="tot" id="vTot"></div>
      <div id="vErr" class="estado error" hidden></div>
      <button class="btn dark block" id="vRegistrar" style="margin-top:12px">${ico('cart')} Registrar venta</button></div>
    <div><div class="card"><div class="card-title">${ico('doc')}Resumen de la venta</div><div class="sumrows" id="vResumen"></div></div>
      <div class="card mt"><div class="card-title">${ico('grid')}Acciones</div><div class="stack">
        <button class="btn dark block" id="vNueva">${ico('cart')} Nueva venta</button>
        <button class="btn block" id="vLimpiar">${ico('refresh')} Limpiar</button>
        <button class="btn block" id="vVerHist">${ico('doc')} Ver historial</button></div></div></div>
  </section>` : ''}
  <section class="card mt" id="vHist">
    <div class="card-title">${ico('doc')}Historial de ventas
      <form class="filters no-print" id="hFiltros"><input class="input" type="date" id="hDesde" aria-label="Desde"><input class="input" type="date" id="hHasta" aria-label="Hasta">
        <select class="input" id="hProd" aria-label="Producto"><option value="">Todos los productos</option></select>
        <select class="input" id="hEstado" aria-label="Estado"><option value="">Todos los estados</option><option value="completada">Completadas</option><option value="anulada">Anuladas</option></select>
        <button class="btn dark sm" type="submit">${ico('filter')} Filtrar</button><button class="btn sm" type="button" id="hLimpiar">Limpiar</button>
        <a class="btn sm" id="hCsv" href="/api/sales/export.csv" download>${ico('download')} CSV</a></form></div>
    <div id="hEstadoMsg" class="estado" hidden></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>N.º venta</th><th>Fecha y hora</th><th>Productos</th><th class="num">Cant.</th><th class="num">Subtotal</th><th class="num">IGV</th><th class="num">Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="hBody"></tbody></table></div>
    <div class="pager" id="hPag"></div><p class="note" id="hTotales"></p>
  </section>`;
}

// ------------------------------------------------------------- nueva venta
async function cargarProductos() {
  try {
    const r = await api.productos({ q: C.q, page: 1, limit: 30, orden: 'nombre', direccion: 'asc' });
    C.prods = r.data;
    if (!C.sel && C.prods.length) C.sel = C.prods.find((p) => p.stock > 0) || null;
    pintarLista();
    pintarDetalle();
  } catch (e) { $('#vLista').innerHTML = `<div class="estado error">${esc(e.message)}</div>`; }
}
function pintarLista() {
  $('#vLista').innerHTML = C.prods.map((p) => `<button class="pitem ${C.sel && C.sel.id === p.id ? 'sel' : ''}" data-id="${p.id}" ${p.stock === 0 ? 'disabled style="opacity:.5"' : ''}>
    <div class="thumb">${zapatilla(p.id)}</div><div><b>${esc(p.nombre)}</b><div>${soles(p.precio)}</div><small>Stock: ${p.stock} | Talla: ${esc(p.talla)}</small></div>${ico('right')}</button>`).join('') || '<div class="estado vacio">Sin resultados.</div>';
}
const enCarrito = (id) => C.lineas.filter((l) => l.p.id === id).reduce((a, l) => a + l.cant, 0);
function pintarDetalle() {
  const p = C.sel;
  if (!p) { $('#vDetalle').innerHTML = '<div class="estado vacio">Selecciona un producto de la lista para empezar.</div>'; pintarTotales(); return; }
  const disp = p.stock - enCarrito(p.id);
  if (C.cant > disp) C.cant = Math.max(1, disp);
  $('#vDetalle').innerHTML = `<div class="detalle"><div class="thumb">${zapatilla(p.id)}</div><div><h3>${esc(p.nombre)}</h3><div class="pr">${soles(p.precio)}</div><small class="note">Stock disponible: <b>${disp}</b> · ${esc(p.sku)}</small></div></div>
    <div class="row3"><div class="field"><label>Talla</label><input class="input" value="${esc(p.talla)}" disabled></div>
      <div class="field"><label for="vCant">Cantidad</label><div class="stepper"><button type="button" id="vMenos" aria-label="Menos">${ico('minus')}</button><input id="vCant" type="number" min="1" max="${disp}" value="${C.cant}"><button type="button" id="vMas" aria-label="Más">${ico('plus')}</button></div></div>
      <div class="field"><label>Subtotal</label><input class="input" id="vSub" value="${soles(p.precio * C.cant)}" disabled></div></div>
    <button class="btn block" id="vAgregar" ${disp < 1 ? 'disabled' : ''}>${ico('plus')} Agregar a la venta</button>`;
  const set = (n) => { C.cant = Math.min(Math.max(1, n || 1), Math.max(1, disp)); $('#vCant').value = C.cant; $('#vSub').value = soles(p.precio * C.cant); };
  $('#vMenos').onclick = () => set(C.cant - 1);
  $('#vMas').onclick = () => set(C.cant + 1);
  $('#vCant').oninput = (e) => set(parseInt(e.target.value, 10));
  $('#vAgregar').onclick = () => {
    const ex = C.lineas.find((l) => l.p.id === p.id);
    if (ex) ex.cant += C.cant; else C.lineas.push({ p, cant: C.cant });
    C.cant = 1; pintarDetalle();
  };
  pintarTotales();
}
function pintarTotales() {
  $('#vLineas').innerHTML = C.lineas.map((l, i) => `<div class="linea"><div class="grow"><b>${esc(l.p.nombre)}</b><small>${l.cant} × ${soles(l.p.precio)}</small></div><b>${soles(l.p.precio * l.cant)}</b><button class="iconbtn" data-q="${i}" aria-label="Quitar ${esc(l.p.nombre)}">${ico('x')}</button></div>`).join('');
  const sub = C.lineas.reduce((a, l) => a + c2(l.p.precio) * l.cant, 0); const igv = igvDe(sub);
  $('#vTot').innerHTML = `<div class="l"><span>Subtotal</span><span>${soles(sub / 100)}</span></div><div class="l"><span>IGV (${IGV}%)</span><span>${soles(igv / 100)}</span></div><div class="l big"><span>Total</span><span>${soles((sub + igv) / 100)}</span></div>`;
  $('#vResumen').innerHTML = `<div class="r"><span>Productos</span><span>${C.lineas.length}</span></div><div class="r"><span>Unidades</span><span>${C.lineas.reduce((a, l) => a + l.cant, 0)}</span></div><div class="r"><span>Subtotal</span><span>${soles(sub / 100)}</span></div><div class="r"><span>IGV (${IGV}%)</span><span>${soles(igv / 100)}</span></div><div class="r big"><span>Total</span><span>${soles((sub + igv) / 100)}</span></div>
    <p class="note">Vista previa. El servidor recalcula precios, IGV y total al registrar.</p>`;
  $('#vRegistrar').disabled = !C.lineas.length;
}
function limpiar() { C.lineas = []; C.cant = 1; $('#vErr').hidden = true; pintarDetalle(); }

async function registrar() {
  const btn = $('#vRegistrar'); btn.disabled = true; $('#vErr').hidden = true;
  try {
    const r = (await api.registrarVenta({ items: C.lineas.map((l) => ({ producto_id: l.p.id, cantidad: l.cant })) })).data;
    toast(`Venta ${numVenta(r.id)} registrada correctamente.`, 'exito');
    C.lineas = []; C.cant = 1; C.sel = null;
    emitirCambio();
    await Promise.all([cargarProductos(), cargarHistorial(true), cargarFiltroProductos()]);
    comprobante(r.id);
  } catch (e) {
    estado($('#vErr'), 'error', e.message, Array.isArray(e.detalles) ? e.detalles : undefined);
    await cargarProductos();
  } finally { pintarTotales(); }
}

async function comprobante(id) {
  try {
    const v = (await api.venta(id)).data;
    dialogo(`<h2>Comprobante ${numVenta(v.id)}</h2><p class="note">${esc(fechaHora(v.fecha))} · <span class="pill ${v.estado === 'anulada' ? 'off' : 'ok'}">${v.estado === 'anulada' ? 'Anulada' : 'Completada'}</span></p>
      <div class="comprobante"><hr>${v.lineas.map((l) => `<div class="l"><span>${l.cantidad} × ${esc(l.producto)}</span><span>${soles(l.subtotal)}</span></div>`).join('')}<hr>
      <div class="l"><span>Subtotal</span><span>${soles(v.subtotal)}</span></div><div class="l"><span>IGV (${v.igv_porcentaje}%)</span><span>${soles(v.igv)}</span></div><div class="l"><b>Total</b><b>${soles(v.total)}</b></div></div>
      <div class="foot"><button class="btn" data-cerrar>Cerrar</button></div>`);
  } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------- historial
async function cargarFiltroProductos() {
  try {
    const r = await api.productos({ page: 1, limit: 100, orden: 'nombre', direccion: 'asc' });
    const val = $('#hProd').value;
    $('#hProd').innerHTML = '<option value="">Todos los productos</option>' + r.data.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    $('#hProd').value = val;
  } catch (_) { /* opcional */ }
}
async function cargarHistorial(volverInicio = false) {
  if (volverInicio) H.page = 1;
  if (H.desde && H.hasta && H.desde > H.hasta) { estado($('#hEstadoMsg'), 'error', 'La fecha «Desde» no puede ser posterior a «Hasta».'); return; }
  const mi = ++tH;
  const qs = new URLSearchParams(Object.entries({ desde: H.desde, hasta: H.hasta, producto_id: H.producto_id, estado: H.estado }).filter(([, v]) => v)).toString();
  $('#hCsv').href = '/api/sales/export.csv' + (qs ? `?${qs}` : '');
  estado($('#hEstadoMsg'), 'cargando', 'Cargando historial…');
  try {
    const r = await api.ventas({ page: H.page, limit: POR, desde: H.desde, hasta: H.hasta, producto_id: H.producto_id, estado: H.estado });
    if (mi !== tH) return;
    $('#hBody').innerHTML = r.data.map((v) => `<tr><td>${numVenta(v.id)}</td><td>${esc(fechaHora(v.fecha))}</td><td title="${esc(v.productos)}">${esc(v.productos.length > 38 ? v.productos.slice(0, 36) + '…' : v.productos)}</td>
      <td class="num">${entero(v.unidades)}</td><td class="num">${soles(v.subtotal)}</td><td class="num">${soles(v.igv)}</td><td class="num"><b>${soles(v.total)}</b></td>
      <td><span class="pill ${v.estado === 'anulada' ? 'off' : 'ok'}">${v.estado === 'anulada' ? 'Anulada' : 'Completada'}</span></td>
      <td><button class="iconbtn" data-ver="${v.id}" aria-label="Ver comprobante ${numVenta(v.id)}">${ico('doc')}</button>${C.puedeVender && v.estado === 'completada' ? `<button class="iconbtn" data-anular="${v.id}" aria-label="Anular ${numVenta(v.id)}">${ico('x')}</button>` : ''}</td></tr>`).join('');
    estado($('#hEstadoMsg'), r.data.length ? null : 'vacio', 'No hay ventas para los filtros seleccionados.');
    paginador($('#hPag'), { page: r.meta.page, paginas: r.meta.paginas, total: r.meta.total, limit: POR }, (n) => { H.page = n; cargarHistorial(); }, 'ventas');
    const t = r.meta.totales;
    $('#hTotales').innerHTML = `Total facturado (ventas completadas con los filtros aplicados): <b>${soles(t.total_facturado)}</b> = subtotal ${soles(t.subtotal)} + IGV ${soles(t.igv)}.`;
  } catch (e) { if (mi === tH) estado($('#hEstadoMsg'), 'error', `No se pudo cargar el historial: ${e.message}`); }
}

export async function montar(cont, { puede }) {
  C.puedeVender = puede('administrador', 'vendedor');
  Object.assign(C, { sel: null, cant: 1, lineas: [], q: '' });
  cont.innerHTML = html();
  if (C.puedeVender) {
    $('#vFecha').textContent = new Date().toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
    $('#vBuscar').oninput = debounce((e) => { C.q = e.target.value.trim(); cargarProductos(); }, 250);
    $('#vLista').onclick = (e) => { const b = e.target.closest('.pitem'); if (!b) return; C.sel = C.prods.find((p) => p.id === Number(b.dataset.id)); C.cant = 1; pintarLista(); pintarDetalle(); };
    $('#vLineas').onclick = (e) => { const b = e.target.closest('[data-q]'); if (b) { C.lineas.splice(Number(b.dataset.q), 1); pintarDetalle(); } };
    $('#vRegistrar').onclick = registrar;
    $('#vLimpiar').onclick = limpiar;
    $('#vNueva').onclick = () => { limpiar(); C.sel = null; C.q = ''; $('#vBuscar').value = ''; cargarProductos(); };
    $('#vVerHist').onclick = () => $('#vHist').scrollIntoView({ behavior: 'smooth' });
    await cargarProductos();
  }
  $('#hFiltros').onsubmit = (e) => { e.preventDefault(); Object.assign(H, { desde: $('#hDesde').value, hasta: $('#hHasta').value, producto_id: $('#hProd').value, estado: $('#hEstado').value }); cargarHistorial(true); };
  $('#hLimpiar').onclick = () => { $('#hFiltros').reset(); Object.assign(H, { desde: '', hasta: '', producto_id: '', estado: '' }); cargarHistorial(true); };
  $('#hBody').onclick = async (e) => {
    const ver = e.target.closest('[data-ver]'); const an = e.target.closest('[data-anular]');
    if (ver) comprobante(Number(ver.dataset.ver));
    if (an) {
      const id = Number(an.dataset.anular);
      if (!(await confirmar({ titulo: 'Anular venta', texto: `¿Anular la venta ${numVenta(id)}? Se devolverá el stock y dejará de contar en los reportes y la predicción.`, botonOk: 'Anular venta' }))) return;
      try { await api.anularVenta(id); toast(`Venta ${numVenta(id)} anulada.`, 'exito'); emitirCambio(); if (C.puedeVender) cargarProductos(); await cargarHistorial(); } catch (err) { toast(err.message, 'error', 6000); }
    }
  };
  Object.assign(H, { page: 1, desde: '', hasta: '', producto_id: '', estado: '' });
  await Promise.all([cargarFiltroProductos(), cargarHistorial()]);
}
