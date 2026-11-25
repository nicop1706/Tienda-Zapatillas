import { api, ApiError } from './api.js';
import { $, $$, esc, soles, entero, estado, toast, confirmar, debounce, paginador, emitirCambio, prepararImagen } from './interfaz.js';
import { ico } from './iconos.js';
import { zapatilla, usarFotos, fotoDe } from './zapatillas.js';

const POR_PAGINA = 12;
const ORDENES = [['id|desc', 'Más recientes'], ['nombre|asc', 'Nombre (A-Z)'], ['precio|asc', 'Precio: menor a mayor'], ['precio|desc', 'Precio: mayor a menor'], ['stock|asc', 'Stock: menor a mayor'], ['vendidos|desc', 'Más vendidos']];
const S = { q: '', categoria: '', orden: 'id', dir: 'desc', page: 1, filas: [], sel: null, esAdmin: false };
let ticket = 0;
// Foto elegida en el panel (se sube al pulsar Guardar): { blob, vista } | quitar: true para borrar la actual
const FOTO = { blob: null, vista: '', quitar: false };
const FOTO_MAX_LADO = 1000;   // px: las fotos grandes del celular se reducen antes de subirlas

const prepararFoto = (archivo) => prepararImagen(archivo, { maxLado: FOTO_MAX_LADO, maxBytes: 3 * 1024 * 1024 });

const CAMPOS = [['nombre', 'pNombre'], ['sku', 'pSku'], ['marca', 'pMarca'], ['modelo', 'pModelo'], ['talla', 'pTalla'], ['precio', 'pPrecio'], ['stock', 'pStock'], ['categoria', 'pCategoria'], ['descripcion', 'pDescripcion']];

function html() {
  return `
  <div class="split" id="split">
    <div class="card">
      <div class="pagehead" style="margin-bottom:10px"><div><h1>Productos</h1><p>Catálogo, precios (sin IGV) y stock</p></div>
        <div class="actions">${S.esAdmin ? `<button class="btn" id="pNuevo">Agregar producto ${ico('plus')}</button>` : ''}
          <select class="input" id="pOrden" aria-label="Ordenar por" style="width:auto">${ORDENES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
          <a class="btn" id="pExportar" href="/api/products/export.csv" download>${ico('download')} CSV</a></div></div>
      <div class="searchbox"><span class="sr-only"><label for="pBuscar">Buscar productos</label></span>${ico('search')}<input class="input" id="pBuscar" type="search" placeholder="Buscar por nombre, SKU, marca o modelo…" style="max-width:520px"></div>
      <div class="chips" id="chips"></div>
      <div id="pEstado" class="estado" hidden></div>
      <div class="pgrid" id="pGrid"></div>
      <div class="pager" id="pPag"></div>
    </div>
    <aside class="card panel-side" id="panel" hidden></aside>
  </div>`;
}

async function cargarChips() {
  try {
    const cats = (await api.categorias()).data;
    const total = cats.reduce((a, c) => a + c.productos, 0);
    $('#chips').innerHTML = `<button class="chipbtn" data-cat="" aria-pressed="${S.categoria === ''}">Todos (${total})</button>` +
      cats.map((c) => `<button class="chipbtn" data-cat="${esc(c.categoria)}" aria-pressed="${S.categoria === c.categoria}">${esc(c.categoria)} (${c.productos})</button>`).join('');
    $('#listaCats').innerHTML = cats.map((c) => `<option value="${esc(c.categoria)}">`).join('');
  } catch (_) { /* chips no críticos */ }
}

async function cargar() {
  const mi = ++ticket;
  $('#pExportar').href = '/api/products/export.csv' + (S.q ? `?q=${encodeURIComponent(S.q)}` : '');
  estado($('#pEstado'), 'cargando', 'Cargando productos…');
  try {
    const r = await api.productos({ q: S.q, categoria: S.categoria, page: S.page, limit: POR_PAGINA, orden: S.orden, direccion: S.dir });
    if (mi !== ticket) return;
    if (!r.data.length && r.meta.total > 0 && S.page > 1) { S.page = r.meta.paginas; return cargar(); }
    S.filas = r.data;
    $('#pGrid').innerHTML = r.data.map((p) => `<button class="pcard ${S.sel === p.id ? 'sel' : ''} ${p.stock === 0 ? 'agotado' : ''}" data-id="${p.id}" aria-label="Ver ${esc(p.nombre)}">
      <div class="img">${zapatilla(p.id)}</div><h3>${esc(p.nombre)}</h3><div class="pr">${soles(p.precio)}</div>
      <div class="meta"><span>Stock: <b>${p.stock === 0 ? 'Agotado' : entero(p.stock)}</b></span><span>Vendidos: <b>${entero(p.vendidos)}</b></span></div></button>`).join('');
    paginador($('#pPag'), { page: r.meta.page, paginas: r.meta.paginas, total: r.meta.total, limit: POR_PAGINA }, (n) => { S.page = n; cargar(); }, 'productos');
    estado($('#pEstado'), r.data.length ? null : 'vacio', S.q || S.categoria ? 'No se encontraron productos con esos filtros.' : 'Aún no hay productos registrados.');
    if (!r.data.length) $('#pPag').innerHTML = '';
  } catch (e) {
    if (mi !== ticket) return;
    estado($('#pEstado'), 'error', `No se pudieron cargar los productos: ${e.message}`);
  }
}

// ----------------------------------------------------------------- panel lateral
function abrirPanel(p) {
  S.sel = p ? p.id : null;
  const panel = $('#panel');
  const ro = !S.esAdmin;
  panel.hidden = false;
  $('#split').classList.add('con-panel');
  panel.innerHTML = `<div class="head">${ico(p ? 'edit' : 'plus')}<span>${p ? (ro ? 'Detalle del producto' : 'Editar producto') : 'Nuevo producto'}</span><button class="iconbtn" id="pCerrar" aria-label="Cerrar panel">${ico('x')}</button></div>
    <div class="hero" id="pHero">${zapatilla(p ? p.id : 'nuevo')}</div>
    ${ro ? '' : `<div class="fotoacc"><input type="file" id="pFoto" accept="image/jpeg,image/png,image/webp" hidden>
      <button type="button" class="btn sm" id="pFotoBtn">${ico('plus')} Subir foto</button>
      <button type="button" class="btn sm" id="pFotoQuitar" hidden>${ico('trash')} Quitar foto</button></div>
      <p class="note fotonota" id="pFotoNota">JPG, PNG o WebP. Se ajusta sola a un tamaño liviano. La foto se guarda al pulsar «${p ? 'Guardar cambios' : 'Crear producto'}».</p>`}
    <form id="pForm" novalidate>
      <div id="pErrorGeneral" class="estado error" hidden></div>
      <div class="field"><label for="pNombre">Nombre del producto</label><input class="input" id="pNombre" maxlength="120" ${ro ? 'disabled' : ''}><span class="err" data-err="nombre"></span></div>
      <div class="row2"><div class="field"><label for="pSku">SKU</label><input class="input" id="pSku" maxlength="40" ${ro ? 'disabled' : ''}><span class="err" data-err="sku"></span></div>
        <div class="field"><label for="pTalla">Talla</label><input class="input" id="pTalla" inputmode="decimal" placeholder="42 o 42.5" ${ro ? 'disabled' : ''}><span class="err" data-err="talla"></span></div></div>
      <div class="row2"><div class="field"><label for="pMarca">Marca</label><input class="input" id="pMarca" maxlength="60" ${ro ? 'disabled' : ''}><span class="err" data-err="marca"></span></div>
        <div class="field"><label for="pModelo">Modelo</label><input class="input" id="pModelo" maxlength="60" ${ro ? 'disabled' : ''}><span class="err" data-err="modelo"></span></div></div>
      <div class="row2"><div class="field"><label for="pPrecio">Precio (S/, sin IGV)</label><input class="input" id="pPrecio" inputmode="decimal" ${ro ? 'disabled' : ''}><span class="err" data-err="precio"></span></div>
        <div class="field"><label for="pStock">Stock</label><input class="input" id="pStock" inputmode="numeric" ${ro ? 'disabled' : ''}><span class="err" data-err="stock"></span></div></div>
      <div class="field"><label for="pCategoria">Categoría</label><input class="input" id="pCategoria" list="listaCats" maxlength="60" ${ro ? 'disabled' : ''}><span class="err" data-err="categoria"></span></div>
      <div class="field"><label for="pDescripcion">Descripción</label><textarea class="input" id="pDescripcion" maxlength="255" ${ro ? 'disabled' : ''}></textarea><span class="err" data-err="descripcion"></span></div>
      ${p ? `<p class="note">Vendidos (ventas completadas): <b>${entero(p.vendidos)}</b></p>` : ''}
      ${ro ? '' : `<div class="foot"><button type="button" class="btn" id="pCancelar">Cancelar</button><button class="btn dark" type="submit" id="pGuardar">${p ? 'Guardar cambios' : 'Crear producto'}</button></div>
      ${p ? `<button type="button" class="btn danger block" id="pEliminar" style="margin-top:10px">${ico('trash')} Eliminar producto</button>` : ''}`}
    </form>`;
  CAMPOS.forEach(([c, id]) => { $('#' + id).value = p ? (p[c] ?? '') : ''; });
  $('#pCerrar').onclick = cerrarPanel;
  FOTO.blob = null; FOTO.vista = ''; FOTO.quitar = false;
  if (!ro) {
    const tieneActual = () => !!(p && fotoDe(p.id) && !FOTO.quitar);
    const refrescarFoto = () => {
      const hero = $('#pHero');
      if (FOTO.blob) hero.innerHTML = `<img class="shoe foto" src="${FOTO.vista}" alt="Foto elegida">`;
      else if (FOTO.quitar) hero.innerHTML = zapatilla(p ? p.id : 'nuevo', true);
      else hero.innerHTML = zapatilla(p ? p.id : 'nuevo');
      $('#pFotoQuitar').hidden = !(FOTO.blob || tieneActual());
      $('#pFotoBtn').lastChild.textContent = ' ' + (FOTO.blob || tieneActual() ? 'Cambiar foto' : 'Subir foto');
    };
    $('#pFotoBtn').onclick = () => $('#pFoto').click();
    $('#pFoto').onchange = async (ev) => {
      const f = ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      try { const r = await prepararFoto(f); FOTO.blob = r.blob; FOTO.vista = r.vista; FOTO.quitar = false; refrescarFoto(); }
      catch (e) { toast(e.message, 'error', 6000); }
    };
    $('#pFotoQuitar').onclick = () => {
      if (FOTO.blob) { FOTO.blob = null; FOTO.vista = ''; } else FOTO.quitar = true;
      refrescarFoto();
    };
    refrescarFoto();
    $('#pCancelar').onclick = cerrarPanel;
    $('#pForm').onsubmit = guardar;
    if (p) $('#pEliminar').onclick = () => eliminar(p);
  }
  $$('.pcard').forEach((c) => c.classList.toggle('sel', Number(c.dataset.id) === S.sel));
  if (window.innerWidth < 960) panel.scrollIntoView({ behavior: 'smooth' });
}
function cerrarPanel() { S.sel = null; $('#panel').hidden = true; $('#split').classList.remove('con-panel'); $$('.pcard.sel').forEach((c) => c.classList.remove('sel')); }

function errores(d) {
  const e = {};
  if (!d.sku) e.sku = 'El SKU es obligatorio.'; else if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(d.sku)) e.sku = '3 a 40 caracteres: letras, números, guion o guion bajo.';
  ['nombre', 'marca', 'modelo', 'categoria'].forEach((c) => { if (!d[c]) e[c] = 'Campo obligatorio.'; });
  if (!/^\d{2}(\.\d)?$/.test(d.talla) || d.talla < 20 || d.talla > 55) e.talla = 'Entre 20 y 55 (ej. 42 o 42.5).';
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(d.precio) || Number(d.precio) <= 0) e.precio = 'Número mayor que 0, hasta 2 decimales.';
  if (!/^\d{1,9}$/.test(d.stock)) e.stock = 'Entero mayor o igual a 0.';
  if (d.descripcion.length > 255) e.descripcion = 'Máximo 255 caracteres.';
  return e;
}
function mostrarErrores(e) {
  $$('#pForm [data-err]').forEach((s) => { s.textContent = ''; });
  $$('#pForm .input').forEach((i) => i.removeAttribute('aria-invalid'));
  let hay = false;
  CAMPOS.forEach(([c, id]) => { if (e[c]) { hay = true; $(`#pForm [data-err="${c}"]`).textContent = e[c]; $('#' + id).setAttribute('aria-invalid', 'true'); } });
  return hay;
}
async function guardar(ev) {
  ev.preventDefault();
  $('#pErrorGeneral').hidden = true;
  const d = {}; CAMPOS.forEach(([c, id]) => { d[c] = $('#' + id).value.trim(); });
  if (mostrarErrores(errores(d))) return;
  const btn = $('#pGuardar'); btn.disabled = true;
  try {
    const r = S.sel ? await api.editarProducto(S.sel, d) : await api.crearProducto(d);
    const idProducto = S.sel || (r && r.data && r.data.id);
    let avisoFoto = '';
    if (idProducto && (FOTO.blob || FOTO.quitar)) {
      try {
        if (FOTO.blob) await api.subirFoto(idProducto, FOTO.blob); else await api.quitarFoto(idProducto);
        usarFotos((await api.imagenes()).data);
      } catch (e) { avisoFoto = ` La foto no se pudo guardar: ${e.message}`; }
    }
    if (avisoFoto) toast('Producto guardado.' + avisoFoto, 'error', 8000);
    else toast(S.sel ? 'Producto actualizado correctamente.' : 'Producto registrado correctamente.', 'exito');
    const nuevo = !S.sel; cerrarPanel(); emitirCambio();
    if (nuevo) { S.q = ''; $('#pBuscar').value = ''; S.categoria = ''; S.orden = 'id'; S.dir = 'desc'; S.page = 1; $('#pOrden').value = 'id|desc'; }
    cargarChips(); await cargar();
  } catch (e) {
    if (e instanceof ApiError && e.detalles && typeof e.detalles === 'object' && !Array.isArray(e.detalles)) mostrarErrores(e.detalles);
    const g = $('#pErrorGeneral'); g.textContent = e.message; g.hidden = false;
  } finally { btn.disabled = false; }
}
async function eliminar(p) {
  if (!(await confirmar({ titulo: 'Eliminar producto', texto: `¿Seguro que deseas eliminar «${p.nombre}» (${p.sku})? Esta acción no se puede deshacer.`, botonOk: 'Eliminar' }))) return;
  try { await api.eliminarProducto(p.id); try { usarFotos((await api.imagenes()).data); } catch (_) { /* sin fotos */ } toast('Producto eliminado.', 'exito'); cerrarPanel(); emitirCambio(); cargarChips(); await cargar(); }
  catch (e) { toast(e.message, 'error', 7000); }
}

export async function montar(cont, { puede }) {
  S.esAdmin = puede('administrador');
  cont.innerHTML = html() + '<datalist id="listaCats"></datalist>';
  $('#pOrden').value = `${S.orden}|${S.dir}`;
  $('#pOrden').onchange = (e) => { [S.orden, S.dir] = e.target.value.split('|'); S.page = 1; cargar(); };
  $('#pBuscar').value = S.q;
  $('#pBuscar').oninput = debounce((e) => { S.q = e.target.value.trim(); S.page = 1; cargar(); }, 300);
  $('#chips').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; S.categoria = b.dataset.cat; S.page = 1; $$('#chips .chipbtn').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); cargar(); };
  $('#pGrid').onclick = (e) => { const c = e.target.closest('.pcard'); if (c) abrirPanel(S.filas.find((p) => p.id === Number(c.dataset.id))); };
  if (S.esAdmin) $('#pNuevo').onclick = () => abrirPanel(null);
  S.sel = null;
  cargarChips();
  await cargar();
}
