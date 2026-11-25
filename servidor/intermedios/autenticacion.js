const { AppError } = require('../utilidades/errores');
const auth = require('../servicios/autenticacionServicio');

const COOKIE = 'sid';

function leerCookie(req, nombre) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const par of h.split(';')) {
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim() === nombre) return decodeURIComponent(par.slice(i + 1).trim());
  }
  return null;
}

function opcionesCookie(maxAgeMs) {
  return { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/', ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) };
}

/** Exige sesión válida; deja req.usuario y req.token. */
async function requerirSesion(req, res, next) {
  try {
    const token = leerCookie(req, COOKIE);
    const u = await auth.usuarioDeToken(token);
    if (!u) throw new AppError(401, 'Tu sesión no es válida o expiró. Inicia sesión nuevamente.', 'NO_AUTENTICADO');
    req.usuario = u;
    req.token = token;
    next();
  } catch (e) { next(e); }
}

/** Exige que el rol del usuario esté en la lista. */
const permitir = (...roles) => (req, res, next) => {
  if (!req.usuario || !roles.includes(req.usuario.rol)) {
    return next(new AppError(403, 'Tu rol no tiene permiso para esta acción.', 'SIN_PERMISO'));
  }
  next();
};

/** Aplica `permitir` solo a métodos que modifican datos. */
const permitirEscritura = (...roles) => (req, res, next) =>
  (['GET', 'HEAD'].includes(req.method) ? next() : permitir(...roles)(req, res, next));

module.exports = { COOKIE, leerCookie, opcionesCookie, requerirSesion, permitir, permitirEscritura };
