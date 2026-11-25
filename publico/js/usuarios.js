import { api } from './api.js';
import { $, $$, esc, estado, toast, confirmar, debounce, paginador, fecha } from './interfaz.js';
import { ico } from './iconos.js';

const POR = 8;
const ROLES = [['administrador', 'Administrador'], ['vendedor', 'Vendedor'], ['analista', 'Analista']];
const S = { q: '', page: 1, todos: [], sel: null, yo: null };

function html() {
  return `<div class="pagehead"><div><h1>Usuarios</h1><p>Gestiona los usuarios del sistema</p></div></div>
  <div class="split con-panel" id="uSplit">
    <div class="card">
      <div class="actions" style="justify-content:space-between;margin-bottom:14px"><div class="searchbox" style="flex:1;max-width:420px">${ico('search')}<label class="sr-only" for="uBuscar">Buscar usuarios</label><input class="input" id="uBuscar" type="search" placeholder="Buscar usuarios…"></div>
        <button class="btn dark" id="uNuevo">${ico('plus')} Agregar usuario</button></div>
      <div id="uEstado" class="estado" hidden></div>
      <div class="tablewrap"><table class="t"><thead><tr><th>ID</th><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead><tbody id="uBody"></tbody></table></div>
      <div class="pager" id="uPag"></div>
    </div>
    <aside class="card panel-side" id="uPanel"></aside>
  </div>`;
}

function pintar() {
  const q = S.q.toLowerCase();
  const filtrados = S.todos.filter((u) => !q || u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR));
  if (S.page > paginas) S.page = paginas;
  const fila = filtrados.slice((S.page - 1) * POR, S.page * POR);
  $('#uBody').innerHTML = fila.map((u) => `<tr><td>${u.id}</td><td><div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="background:var(--soft)">${ico('user')}</span>${esc(u.nombre)}</div></td>
    <td>${esc(u.email)}</td><td><span class="pill">${esc(ROLES.find((r) => r[0] === u.rol)[1])}</span></td>
    <td><span class="pill dot ${u.activo ? 'ok' : 'off'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td><td>${u.ultimo_acceso ? esc(fecha(u.ultimo_acceso)) : '—'}</td>
    <td><button class="iconbtn" data-ed="${u.id}" aria-label="Editar ${esc(u.nombre)}">${ico('edit')}</button><button class="iconbtn" data-del="${u.id}" aria-label="Eliminar ${esc(u.nombre)}">${ico('trash')}</button></td></tr>`).join('');
  estado($('#uEstado'), filtrados.length ? null : 'vacio', 'No se encontraron usuarios.');
  paginador($('#uPag'), { page: S.page, paginas, total: filtrados.length, limit: POR }, (n) => { S.page = n; pintar(); }, 'usuarios');
}

async function cargar() {
  try { S.todos = (await api.usuarios()).data; pintar(); }
  catch (e) { estado($('#uEstado'), 'error', `No se pudieron cargar los usuarios: ${e.message}`); }
}

function panel(u) {
  S.sel = u ? u.id : null;
  $('#uPanel').innerHTML = `<div class="head">${ico('userplus')}<span>${u ? 'Editar usuario' : 'Agregar usuario'}</span></div>
  <form id="uForm" novalidate><div id="uErr" class="errbox" hidden></div>
    <div class="field"><label for="uNombre">Nombre completo</label><input class="input" id="uNombre" maxlength="100" placeholder="Ingresa el nombre completo"><span class="err" data-e="nombre"></span></div>
    <div class="field"><label for="uEmail">Correo electrónico</label><div class="inputicon">${ico('mail')}<input class="input" id="uEmail" type="email" maxlength="150" placeholder="usuario@empresa.com"></div><span class="err" data-e="email"></span></div>
    <div class="field"><label for="uPass">${u ? 'Nueva contraseña (opcional)' : 'Contraseña'}</label><div class="inputicon">${ico('lock')}<input class="input" id="uPass" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div><span class="err" data-e="password"></span></div>
    <div class="field"><label for="uRol">Rol</label><div class="inputicon">${ico('shield')}<select class="input" id="uRol">${ROLES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div><span class="err" data-e="rol"></span></div>
    <div class="field"><label>Estado</label><label class="switch"><input type="checkbox" id="uActivo" checked><span id="uActivoTxt">Activo</span></label></div>
    <div class="foot"><button type="button" class="btn" id="uCancelar">Cancelar</button><button class="btn dark" type="submit">Guardar usuario</button></div>
    <p class="note">Administrador: todo. Vendedor: registra y consulta ventas. Analista: predicciones y reportes.</p></form>`;
  $('#uNombre').value = u ? u.nombre : ''; $('#uEmail').value = u ? u.email : ''; $('#uRol').value = u ? u.rol : 'vendedor'; $('#uActivo').checked = u ? u.activo : true;
  $('#uActivo').onchange = () => { $('#uActivoTxt').textContent = $('#uActivo').checked ? 'Activo' : 'Inactivo'; };
  $('#uActivoTxt').textContent = $('#uActivo').checked ? 'Activo' : 'Inactivo';
  $('#uCancelar').onclick = () => panel(null);
  $('#uForm').onsubmit = guardar;
}

async function guardar(ev) {
  ev.preventDefault();
  $$('#uForm .err').forEach((e) => { e.textContent = ''; }); $('#uErr').hidden = true;
  const d = { nombre: $('#uNombre').value.trim(), email: $('#uEmail').value.trim(), rol: $('#uRol').value, activo: $('#uActivo').checked };
  const pass = $('#uPass').value;
  if (pass || !S.sel) d.password = pass;
  try {
    if (S.sel) await api.editarUsuario(S.sel, d); else await api.crearUsuario(d);
    toast('Usuario guardado correctamente.', 'exito'); panel(null); await cargar();
  } catch (e) {
    const det = e.detalles && typeof e.detalles === 'object' ? e.detalles : {};
    Object.entries(det).forEach(([k, v]) => { const s = $(`#uForm [data-e="${k}"]`); if (s) s.textContent = v; });
    $('#uErr').textContent = e.message; $('#uErr').hidden = false;
  }
}

export async function montar(cont, { usuario }) {
  S.yo = usuario; S.q = ''; S.page = 1;
  cont.innerHTML = html();
  panel(null);
  $('#uBuscar').oninput = debounce((e) => { S.q = e.target.value.trim(); S.page = 1; pintar(); }, 200);
  $('#uNuevo').onclick = () => panel(null);
  $('#uBody').onclick = async (e) => {
    const ed = e.target.closest('[data-ed]'); const del = e.target.closest('[data-del]');
    if (ed) panel(S.todos.find((u) => u.id === Number(ed.dataset.ed)));
    if (del) {
      const u = S.todos.find((x) => x.id === Number(del.dataset.del));
      if (!(await confirmar({ titulo: 'Eliminar usuario', texto: `¿Eliminar a «${u.nombre}»? Esta acción no se puede deshacer.`, botonOk: 'Eliminar' }))) return;
      try { await api.eliminarUsuario(u.id); toast('Usuario eliminado.', 'exito'); if (S.sel === u.id) panel(null); await cargar(); } catch (err) { toast(err.message, 'error', 6000); }
    }
  };
  await cargar();
}
