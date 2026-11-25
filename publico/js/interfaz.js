// Utilidades de interfaz compartidas: formato, notificaciones, confirmaciones y estados.

const fmtSoles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fmtEntero = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
const fmtDecimal = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const soles = (n) => fmtSoles.format(Number(n) || 0);
export const entero = (n) => fmtEntero.format(Number(n) || 0);
export const decimal = (n) => fmtDecimal.format(Number(n) || 0);

/** Escapa texto para insertarlo en innerHTML (evita XSS con nombres de productos, etc.). */
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function toast(mensaje, tipo = 'info', ms = 4500) {
  const cont = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.textContent = mensaje;
  cont.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * Muestra un estado en un contenedor: tipo = cargando | error | vacio | exito.
 * `detalles` (opcional) es una lista de textos.
 */
export function estado(el, tipo, mensaje, detalles) {
  if (!tipo) { el.hidden = true; el.textContent = ''; el.className = 'estado'; return; }
  el.className = `estado ${tipo}`;
  el.textContent = mensaje;
  if (Array.isArray(detalles) && detalles.length) {
    const ul = document.createElement('ul');
    detalles.forEach((d) => { const li = document.createElement('li'); li.textContent = d; ul.appendChild(li); });
    el.appendChild(ul);
  }
  el.hidden = false;
}

/** Diálogo de confirmación accesible. Devuelve una promesa<boolean>. */
export function confirmar({ titulo = 'Confirmar', texto, botonOk = 'Confirmar' }) {
  const dlg = $('#dlgConfirmar');
  $('#confTitulo').textContent = titulo;
  $('#confTexto').textContent = texto;
  $('#confSi').textContent = botonOk;
  return new Promise((resolve) => {
    const cerrar = () => resolve(dlg.returnValue === 'ok');
    dlg.addEventListener('close', cerrar, { once: true });
    dlg.returnValue = 'cancel';
    dlg.showModal();
    $('#confNo').focus();
  });
}

/** Deshabilita un botón mientras se ejecuta una acción asíncrona. */
export async function conBoton(boton, textoOcupado, accion) {
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = textoOcupado;
  try { return await accion(); } finally { boton.disabled = false; boton.textContent = original; }
}

export const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function emitirCambio() {
  document.dispatchEvent(new CustomEvent('datos:cambiaron'));
}

/** Umbral (unidades) por debajo del cual un producto se considera con stock bajo. */
export const UMBRAL_STOCK_BAJO = 10;

/** Descarga un texto como archivo (usado para exportar el pronóstico a CSV, generado en el navegador). */
export function descargarTexto(nombre, texto, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + texto], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Escapa una celda CSV y neutraliza fórmulas (= + - @) en textos. */
export function celdaCsv(v) {
  if (typeof v === 'number') return String(v);
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

// ---------------------------------------------------------------- helpers de vista
import { ico } from './iconos.js';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
/** 'AAAA-MM' -> 'Nov 26' */
export const mesCorto = (p) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`;
/** 'AAAA-MM-DD hh:mm:ss' -> 'DD/MM/AAAA hh:mm' */
export const fechaHora = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)} ${f.slice(11, 16)}`;
export const fecha = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
export const numVenta = (id) => `V-${String(id).padStart(5, '0')}`;

/** Chip de variación porcentual (null => no se muestra nada, no hay base de comparación). */
export function chipVar(pct) {
  if (pct === null || pct === undefined) return '';
  const neg = pct < 0;
  return `<span class="chip-var ${neg ? 'neg' : ''}">${ico(neg ? 'down' : 'up')}${neg ? '' : '+'}${String(pct).replace('.', ',')}%</span>`;
}

/** Pinta una paginación y avisa con onPage(n). */
export function paginador(cont, { page, paginas, total, limit }, onPage, etiqueta = 'resultados') {
  const desde = total === 0 ? 0 : (page - 1) * limit + 1;
  const hasta = Math.min(total, page * limit);
  const nums = [];
  for (let i = 1; i <= paginas; i++) if (i === 1 || i === paginas || Math.abs(i - page) <= 1) nums.push(i);
  const btns = []; let prev = 0;
  nums.forEach((n) => { if (n - prev > 1) btns.push('<span>…</span>'); btns.push(`<button data-p="${n}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`); prev = n; });
  cont.innerHTML = `<span>Mostrando ${entero(desde)} a ${entero(hasta)} de ${entero(total)} ${etiqueta}</span>
    <nav aria-label="Paginación"><button data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Anterior">${ico('left')}</button>${btns.join('')}
    <button data-p="${page + 1}" ${page >= paginas ? 'disabled' : ''} aria-label="Siguiente">${ico('right')}</button></nav>`;
  cont.onclick = (ev) => { const b = ev.target.closest('button[data-p]'); if (b && !b.disabled) onPage(Number(b.dataset.p)); };
}

/** Rangos rápidos de fechas -> {desde, hasta} en AAAA-MM-DD. */
export function rangoPreset(p) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const h = new Date();
  const hoy = iso(h);
  switch (p) {
    case '30d': return { desde: iso(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 29)), hasta: hoy };
    case '3m': return { desde: iso(new Date(h.getFullYear(), h.getMonth() - 2, 1)), hasta: hoy };
    case '6m': return { desde: iso(new Date(h.getFullYear(), h.getMonth() - 5, 1)), hasta: hoy };
    case 'anio': return { desde: `${h.getFullYear()}-01-01`, hasta: hoy };
    default: return { desde: '', hasta: '' };
  }
}
export const OPC_RANGO = [['30d', 'Últimos 30 días'], ['3m', 'Últimos 3 meses'], ['6m', 'Últimos 6 meses'], ['anio', 'Este año'], ['todo', 'Todo el historial'], ['custom', 'Personalizado…']];

/** Abre el diálogo general con HTML ya escapado; devuelve el <dialog>. */
export function dialogo(html) {
  const d = $('#dlgGeneral');
  d.innerHTML = html;
  d.showModal();
  d.addEventListener('click', (ev) => { if (ev.target.closest('[data-cerrar]')) d.close(); });
  return d;
}

/**
 * Reduce y recodifica una imagen elegida por el usuario (WebP; PNG si el navegador no soporta WebP).
 * Devuelve { blob, vista } donde `vista` es un data URL para la vista previa.
 */
export async function prepararImagen(archivo, { maxLado = 1000, maxBytes = 3 * 1024 * 1024, calidad = 0.88 } = {}) {
  if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) throw new Error('Elige una imagen JPG, PNG o WebP.');
  if (archivo.size > 20 * 1024 * 1024) throw new Error('La imagen es demasiado pesada (máximo 20 MB).');
  let bmp;
  try { bmp = await createImageBitmap(archivo); } catch (_) { throw new Error('No se pudo leer la imagen. Prueba con otra.'); }
  const k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/webp', calidad));
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  if (blob.size > maxBytes) throw new Error('La imagen sigue siendo muy pesada. Prueba con otra más pequeña.');
  const vista = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(blob); });
  return { blob, vista };
}
