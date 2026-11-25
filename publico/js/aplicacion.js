// Punto de entrada: sesión, navegación por hash, menú de usuario y alertas.
import { $, esc, toast, entero, estado, prepararImagen } from './interfaz.js';
import { ico } from './iconos.js';
import { api, ApiError } from './api.js';
import { destruirTodos } from './graficos.js';
import { usarFotos } from './zapatillas.js';

const RUTAS = {
  dashboard: { titulo: 'Dashboard', icono: 'home', roles: ['administrador', 'vendedor', 'analista'], modulo: () => import('./panel.js') },
  productos: { titulo: 'Productos', icono: 'box', roles: ['administrador', 'vendedor', 'analista'], modulo: () => import('./productos.js') },
  ventas: { titulo: 'Ventas', icono: 'mail', roles: ['administrador', 'vendedor', 'analista'], modulo: () => import('./ventas.js') },
  prediccion: { titulo: 'Predicción', icono: 'trend', roles: ['administrador', 'analista'], modulo: () => import('./prediccion.js') },
  reportes: { titulo: 'Reportes', icono: 'chart', roles: ['administrador', 'analista'], modulo: () => import('./reportes.js') },
  usuarios: { titulo: 'Usuarios', icono: 'users', roles: ['administrador'], modulo: () => import('./usuarios.js') },
};
const ROL_ETIQUETA = { administrador: 'Administrador', vendedor: 'Vendedor', analista: 'Analista' };

let usuario = null;
let ticket = 0;
let vistaActual = null;

export const sesion = () => usuario;
export const puede = (...roles) => roles.includes(usuario.rol);

function pintarNav() {
  $('#brand').innerHTML = `${ico('logo')}<span>FootWear Admin</span>`;
  $('#menuBtn').innerHTML = ico('grid');
  $('#bellBtn').innerHTML = ico('bell');
  $('#navlinks').innerHTML = Object.entries(RUTAS).filter(([, r]) => r.roles.includes(usuario.rol))
    .map(([k, r]) => `<a href="#/${k}" data-ruta="${k}">${ico(r.icono)}${r.titulo}</a>`).join('');
  const nombre = usuario.nombre.split(' ')[0];
  $('#userBtn').innerHTML = `<span class="avatar">${esc(usuario.nombre.trim()[0].toUpperCase())}</span><span class="nm">${esc(nombre)}</span>${ico('chev')}`;
  $('#menuUsuario').innerHTML = `<div class="menu-head"><b>${esc(usuario.nombre)}</b><small>${esc(usuario.email)}</small><small>${ROL_ETIQUETA[usuario.rol]}</small></div>
    <button id="mPass">${ico('key')} Cambiar contraseña</button>
    ${usuario.rol === 'administrador' ? `<input type="file" id="mPortadaArchivo" accept="image/jpeg,image/png,image/webp" hidden>
    <button id="mPortada">${ico('plus')} Portada del login…</button>` : ''}
    <button id="mSalir">${ico('logout')} Cerrar sesión</button>`;
}

async function cargarAlertas() {
  try {
    const r = await api.stockBajo(10);
    const n = r.data.total;
    $('#bellBtn').innerHTML = ico('bell') + (n ? `<span class="badge-dot">${n}</span>` : '');
    $('#menuAlertas').innerHTML = `<div class="menu-head"><b>Alertas de stock</b><small>Productos con 10 unidades o menos</small></div>` +
      (n ? `<ul>${r.data.productos.map((p) => `<li><span>${esc(p.nombre)}<br><small>${esc(p.sku)}</small></span><b>${p.stock === 0 ? 'Agotado' : p.stock + ' uds.'}</b></li>`).join('')}</ul>` : '<p class="note" style="padding:8px 12px">Sin alertas: todo el inventario está sobre el umbral.</p>');
  } catch (_) { /* las alertas no son críticas */ }
}

async function navegar() {
  const nombre = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const ruta = RUTAS[nombre] && RUTAS[nombre].roles.includes(usuario.rol) ? nombre : 'dashboard';
  if (ruta !== nombre) { location.replace('#/' + ruta); return; }
  const mi = ++ticket;
  document.querySelectorAll('#navlinks a').forEach((a) => {
    const act = a.dataset.ruta === ruta; a.classList.toggle('active', act);
    act ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  $('#navlinks').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false');
  document.title = `${RUTAS[ruta].titulo} · FootWear Admin`;
  destruirTodos();
  const cont = $('#vista');
  cont.innerHTML = '<div class="estado cargando">Cargando…</div>';
  try {
    const m = await RUTAS[ruta].modulo();
    if (mi !== ticket) return;
    cont.innerHTML = '';
    vistaActual = m;
    await m.montar(cont, { usuario, puede, refrescarAlertas: cargarAlertas });
  } catch (e) {
    if (mi !== ticket) return;
    cont.innerHTML = '<div class="estado error" id="errVista"></div>';
    estado($('#errVista'), 'error', `No se pudo cargar la pantalla: ${e.message}`);
  }
}

function menus() {
  const cerrar = () => { $('#menuAlertas').hidden = true; $('#menuUsuario').hidden = true; };
  $('#bellBtn').addEventListener('click', (e) => { e.stopPropagation(); const v = $('#menuAlertas').hidden; cerrar(); $('#menuAlertas').hidden = !v; });
  $('#userBtn').addEventListener('click', (e) => { e.stopPropagation(); const v = $('#menuUsuario').hidden; cerrar(); $('#menuUsuario').hidden = !v; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) cerrar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
  $('#menuBtn').addEventListener('click', () => { const a = $('#navlinks').classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', String(a)); });
  $('#mSalir').addEventListener('click', async () => { try { await api.logout(); } finally { location.replace('/inicio-sesion.html'); } });
  $('#mPass').addEventListener('click', () => { cerrar(); cambiarPassword(); });
  const mp = $('#mPortada');
  if (mp) mp.addEventListener('click', () => { cerrar(); portadaLogin(); });
}

/** Diálogo para cambiar o quitar la imagen de portada de la pantalla de inicio de sesión (solo administrador). */
async function portadaLogin() {
  let actual = null;
  try { actual = (await api.portada()).data.url; } catch (_) { /* sin portada */ }
  let nueva = null;   // { blob, vista }
  const d = $('#dlgGeneral');
  d.innerHTML = `<h2>Portada del login</h2>
    <p class="sub" style="color:var(--mut);font-size:14px">Es la imagen grande de la izquierda al iniciar sesión. Lo ideal: foto horizontal (p. ej. 1600 × 1000 px) con fondo claro y espacio libre arriba para el título; las zapatillas, hacia abajo. Se ajusta sola.</p>
    <div class="portada-prev" id="ppPrev"></div>
    <input type="file" id="ppArchivo" accept="image/jpeg,image/png,image/webp" hidden>
    <div class="foot"><button type="button" class="btn" id="ppQuitar" ${actual ? '' : 'hidden'}>Quitar portada</button>
      <button type="button" class="btn" id="ppElegir">${ico('plus')} Elegir imagen</button>
      <button type="button" class="btn" data-c>Cerrar</button>
      <button type="button" class="btn dark" id="ppGuardar" disabled>Guardar</button></div>`;
  const prev = () => {
    const src = nueva ? nueva.vista : actual;
    $('#ppPrev').innerHTML = src ? `<img src="${src}" alt="Vista previa de la portada">` : '<span>Sin portada: se muestra la ilustración por defecto.</span>';
  };
  prev();
  d.querySelector('[data-c]').onclick = () => d.close();
  $('#ppElegir').onclick = () => $('#ppArchivo').click();
  $('#ppArchivo').onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try { nueva = await prepararImagen(f, { maxLado: 1600, maxBytes: 5 * 1024 * 1024, calidad: 0.85 }); prev(); $('#ppGuardar').disabled = false; }
    catch (e) { toast(e.message, 'error', 6000); }
  };
  $('#ppGuardar').onclick = async () => {
    const b = $('#ppGuardar'); b.disabled = true;
    try { actual = (await api.subirPortada(nueva.blob)).data.url; nueva = null; toast('Portada guardada. Cierra sesión para verla en el login.', 'exito', 6000); prev(); $('#ppQuitar').hidden = false; }
    catch (e) { toast(e.message, 'error', 6000); b.disabled = false; }
  };
  $('#ppQuitar').onclick = async () => {
    try { await api.quitarPortada(); actual = null; nueva = null; toast('Portada quitada.', 'exito'); prev(); $('#ppQuitar').hidden = true; $('#ppGuardar').disabled = true; }
    catch (e) { toast(e.message, 'error', 6000); }
  };
  d.showModal();
}

function cambiarPassword() {
  const d = $('#dlgGeneral');
  d.innerHTML = `<form id="fPass"><h2>Cambiar contraseña</h2>
    <div class="field"><label for="pa">Contraseña actual</label><input class="input" id="pa" type="password" autocomplete="current-password" required><span class="err" data-e="actual"></span></div>
    <div class="field"><label for="pn">Nueva contraseña (mínimo 8 caracteres)</label><input class="input" id="pn" type="password" autocomplete="new-password" required><span class="err" data-e="nueva"></span></div>
    <div class="foot"><button type="button" class="btn" data-c>Cancelar</button><button class="btn dark" type="submit">Guardar</button></div></form>`;
  d.showModal();
  d.querySelector('[data-c]').onclick = () => d.close();
  d.querySelector('#fPass').onsubmit = async (ev) => {
    ev.preventDefault();
    d.querySelectorAll('.err').forEach((e) => { e.textContent = ''; });
    try { await api.cambiarPassword($('#pa').value, $('#pn').value); d.close(); toast('Contraseña actualizada.', 'exito'); }
    catch (e) {
      const det = e.detalles || {};
      if (det.actual) d.querySelector('[data-e=actual]').textContent = det.actual;
      else if (det.password) d.querySelector('[data-e=nueva]').textContent = det.password;
      else d.querySelector('[data-e=actual]').textContent = e.message;
    }
  };
}

(async () => {
  try {
    usuario = (await api.yo()).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return; // api.js ya redirige al login
    $('#vista').innerHTML = `<div class="estado error">${esc(e.message)}</div>`;
    return;
  }
  try { usarFotos((await api.imagenes()).data); } catch (_) { /* sin fotos: se usan las ilustraciones */ }
  pintarNav();
  menus();
  cargarAlertas();
  document.addEventListener('datos:cambiaron', cargarAlertas);
  window.addEventListener('hashchange', navegar);
  navegar();
})();
