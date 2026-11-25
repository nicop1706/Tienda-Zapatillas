import { ico } from './iconos.js';
import { zapatilla } from './zapatillas.js';
import { api } from './api.js';

const $ = (s) => document.querySelector(s);
$('#logoL').innerHTML = `${ico('logo')} FootWear Admin`;
$('#heroShoe').innerHTML = zapatilla('AND-RUN-001');
$('#feats').innerHTML = [['chart', 'Predicción<br>de ventas'], ['box', 'Control de<br>inventario'], ['trend', 'Reportes<br>en tiempo real']]
  .map(([i, t]) => `<div>${ico(i)}<span>${t}</span></div>`).join('');
$('#wrapEmail').insertAdjacentHTML('afterbegin', ico('mail'));
$('#wrapPass').insertAdjacentHTML('afterbegin', ico('lock'));
$('#eye').innerHTML = ico('eye');
$('#ok').innerHTML = `Iniciar sesión ${ico('arrow')}`;

$('#eye').addEventListener('click', () => {
  const p = $('#pass'); const ver = p.type === 'password';
  p.type = ver ? 'text' : 'password';
  $('#eye').innerHTML = ico(ver ? 'eyeoff' : 'eye');
  $('#eye').setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

// Portada personalizada (la sube el administrador desde el menú de usuario). Si no hay, queda la ilustración.
fetch('/api/portada').then((r) => r.json()).then((j) => {
  const url = j && j.data && j.data.url;
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    const izq = document.querySelector('.login .left');
    izq.style.setProperty('--portada', `url("${url}")`);   // CSSOM: permitido por la CSP
    izq.classList.add('con-portada');
    $('#heroShoe').hidden = true;
  };
  img.src = url;
}).catch(() => {});

// Si ya hay sesión válida, entra directo
fetch('/api/auth/me').then((r) => { if (r.ok) location.replace('/'); }).catch(() => {});

$('#form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('#err'); err.hidden = true;
  const email = $('#email').value.trim(); const pass = $('#pass').value;
  if (!email || !pass) { err.textContent = 'Ingresa tu correo y tu contraseña.'; err.hidden = false; return; }
  const btn = $('#ok'); btn.disabled = true;
  try {
    await api.login(email, pass);
    location.replace('/');
  } catch (e) {
    err.textContent = e.message; err.hidden = false; btn.disabled = false;
  }
});
