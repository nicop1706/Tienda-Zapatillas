const router = require('express').Router();
const auth = require('../servicios/autenticacionServicio');
const { ok } = require('../utilidades/respuesta');
const { AppError, asyncHandler } = require('../utilidades/errores');
const { COOKIE, leerCookie, opcionesCookie, requerirSesion } = require('../intermedios/autenticacion');

// Límite de intentos de login por IP+correo (en memoria): 8 fallos / 10 min
const intentos = new Map();
const VENTANA = 10 * 60 * 1000;
const MAX = 8;
function bloqueado(clave) {
  const e = intentos.get(clave);
  if (!e) return false;
  if (Date.now() - e.desde > VENTANA) { intentos.delete(clave); return false; }
  return e.n >= MAX;
}
function fallo(clave) {
  const e = intentos.get(clave);
  if (!e || Date.now() - e.desde > VENTANA) intentos.set(clave, { n: 1, desde: Date.now() });
  else e.n += 1;
}

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const clave = `${req.ip}|${String(email || '').toLowerCase()}`;
  if (bloqueado(clave)) throw new AppError(429, 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.', 'DEMASIADOS_INTENTOS');
  try {
    const r = await auth.login(email, password);
    intentos.delete(clave);
    res.cookie(COOKIE, r.token, opcionesCookie(r.maxAgeMs));
    ok(res, r.usuario);
  } catch (e) {
    if (e.status === 401) fallo(clave);
    throw e;
  }
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await auth.logout(leerCookie(req, COOKIE));
  res.clearCookie(COOKIE, opcionesCookie());
  ok(res, { cerrada: true });
}));

router.get('/me', requerirSesion, (req, res) => ok(res, req.usuario));

router.post('/password', requerirSesion, asyncHandler(async (req, res) => {
  const { actual, nueva } = req.body || {};
  await auth.cambiarPassword(req.usuario.id, actual, nueva, req.token);
  ok(res, { cambiada: true });
}));

module.exports = router;
