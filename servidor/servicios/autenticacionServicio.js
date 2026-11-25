const crypto = require('crypto');
const { pool } = require('../configuracion/baseDatos');
const { AppError } = require('../utilidades/errores');

const ROLES = ['administrador', 'vendedor', 'analista'];
const HORAS_SESION = Number(process.env.SESSION_HOURS) || 8;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,80}\.[^\s@]{2,}$/;

const scrypt = (clave, sal, o) => new Promise((res, rej) => {
  crypto.scrypt(clave, sal, o.keylen, { N: o.N, r: o.r, p: o.p }, (e, k) => (e ? rej(e) : res(k)));
});

async function hashPassword(clave) {
  const sal = crypto.randomBytes(16);
  const h = await scrypt(clave, sal, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('hex')}$${h.toString('hex')}`;
}

async function verificarPassword(clave, almacenado) {
  const [alg, N, r, p, sal, hash] = String(almacenado).split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const esperado = Buffer.from(hash, 'hex');
  const calc = await scrypt(clave, Buffer.from(sal, 'hex'), { N: +N, r: +r, p: +p, keylen: esperado.length });
  return crypto.timingSafeEqual(calc, esperado);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const publico = (u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, activo: !!u.activo, creado_en: u.creado_en, ultimo_acceso: u.ultimo_acceso });

function validarPassword(clave) {
  if (typeof clave !== 'string' || clave.length < 8 || clave.length > 100) {
    throw new AppError(400, 'La contraseña debe tener entre 8 y 100 caracteres.', 'VALIDACION', { password: 'Mínimo 8 caracteres.' });
  }
}

function validarUsuario(d, { parcial = false } = {}) {
  const err = {};
  if (!parcial || d.nombre !== undefined) {
    if (typeof d.nombre !== 'string' || d.nombre.trim().length < 2 || d.nombre.trim().length > 100) err.nombre = 'Nombre de 2 a 100 caracteres.';
  }
  if (!parcial || d.email !== undefined) {
    if (typeof d.email !== 'string' || !RE_EMAIL.test(d.email.trim()) || d.email.length > 150) err.email = 'Correo electrónico no válido.';
  }
  if (!parcial || d.rol !== undefined) {
    if (!ROLES.includes(d.rol)) err.rol = `El rol debe ser: ${ROLES.join(', ')}.`;
  }
  if (Object.keys(err).length) throw new AppError(400, 'Hay datos no válidos.', 'VALIDACION', err);
}

// ---------------------------------------------------------------- sesiones
async function login(email, password) {
  if (typeof email !== 'string' || typeof password !== 'string') throw new AppError(400, 'Ingresa correo y contraseña.', 'VALIDACION');
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email.trim().toLowerCase()]);
  const u = rows[0];
  // Se verifica siempre (aunque no exista) para no revelar por tiempo si el correo existe
  const falso = 'scrypt$16384$8$1$00000000000000000000000000000000$' + '0'.repeat(128);
  const ok = await verificarPassword(password, u ? u.password_hash : falso);
  if (!u || !ok) throw new AppError(401, 'Correo o contraseña incorrectos.', 'CREDENCIALES');
  if (!u.activo) throw new AppError(403, 'Tu usuario está desactivado. Contacta al administrador.', 'USUARIO_INACTIVO');
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('DELETE FROM sesiones WHERE expira_en < NOW()');
  await pool.query('INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))', [sha(token), u.id, HORAS_SESION]);
  await pool.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [u.id]);
  return { token, usuario: publico(u), maxAgeMs: HORAS_SESION * 3600 * 1000 };
}

async function usuarioDeToken(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [rows] = await pool.query(
    `SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira_en > NOW() AND u.activo = 1`, [sha(token)]);
  return rows[0] ? publico(rows[0]) : null;
}

async function logout(token) {
  if (token) await pool.query('DELETE FROM sesiones WHERE token_hash = ?', [sha(token)]);
}

async function cambiarPassword(usuarioId, actual, nueva, tokenActual) {
  validarPassword(nueva);
  const [rows] = await pool.query('SELECT password_hash FROM usuarios WHERE id = ?', [usuarioId]);
  if (!rows[0] || !(await verificarPassword(String(actual || ''), rows[0].password_hash))) {
    throw new AppError(400, 'La contraseña actual no es correcta.', 'VALIDACION', { actual: 'Contraseña incorrecta.' });
  }
  await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await hashPassword(nueva), usuarioId]);
  // Cierra las demás sesiones de este usuario
  await pool.query('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash <> ?', [usuarioId, sha(tokenActual || '')]);
}

// ---------------------------------------------------------------- usuarios (CRUD)
async function listar() {
  const [rows] = await pool.query('SELECT * FROM usuarios ORDER BY id');
  return rows.map(publico);
}

async function crear(d) {
  validarUsuario(d);
  validarPassword(d.password);
  const email = d.email.trim().toLowerCase();
  try {
    const [r] = await pool.query('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
      [d.nombre.trim(), email, await hashPassword(d.password), d.rol]);
    return obtener(r.insertId);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new AppError(409, 'Ya existe un usuario con ese correo.', 'DUPLICADO', { email: 'Correo ya registrado.' });
    throw e;
  }
}

async function obtener(id) {
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!rows[0]) throw new AppError(404, 'Usuario no encontrado.', 'NO_ENCONTRADO');
  return publico(rows[0]);
}

async function contarAdminsActivos(excluirId) {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM usuarios WHERE rol='administrador' AND activo=1 AND id <> ?", [excluirId]);
  return n;
}

async function actualizar(id, d, actorId) {
  const actual = await obtener(id);
  validarUsuario({ ...actual, ...d }, { parcial: false });
  const activo = d.activo === undefined ? actual.activo : !!d.activo;
  const rol = d.rol ?? actual.rol;
  if ((rol !== 'administrador' || !activo) && actual.rol === 'administrador' && actual.activo && (await contarAdminsActivos(id)) === 0) {
    throw new AppError(409, 'Debe quedar al menos un administrador activo.', 'ULTIMO_ADMIN');
  }
  if (id === actorId && !activo) throw new AppError(409, 'No puedes desactivar tu propio usuario.', 'AUTO_DESACTIVAR');
  const campos = ['nombre = ?', 'email = ?', 'rol = ?', 'activo = ?'];
  const vals = [(d.nombre ?? actual.nombre).trim(), (d.email ?? actual.email).trim().toLowerCase(), rol, activo ? 1 : 0];
  if (d.password) { validarPassword(d.password); campos.push('password_hash = ?'); vals.push(await hashPassword(d.password)); }
  try {
    await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`, [...vals, id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new AppError(409, 'Ya existe un usuario con ese correo.', 'DUPLICADO', { email: 'Correo ya registrado.' });
    throw e;
  }
  if (!activo || d.password) await pool.query('DELETE FROM sesiones WHERE usuario_id = ?', [id]);
  return obtener(id);
}

async function eliminar(id, actorId) {
  const u = await obtener(id);
  if (id === actorId) throw new AppError(409, 'No puedes eliminar tu propio usuario.', 'AUTO_ELIMINAR');
  if (u.rol === 'administrador' && u.activo && (await contarAdminsActivos(id)) === 0) {
    throw new AppError(409, 'Debe quedar al menos un administrador activo.', 'ULTIMO_ADMIN');
  }
  await pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
}

/** Crea el administrador inicial si la tabla está vacía. Devuelve {email,password,generada} o null. */
async function asegurarAdministrador() {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM usuarios');
  if (n > 0) return null;
  const email = (process.env.ADMIN_EMAIL || 'admin@footwear.local').trim().toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  const generada = !password;
  if (generada) password = crypto.randomBytes(9).toString('base64url');
  await pool.query("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Administrador', ?, ?, 'administrador')", [email, await hashPassword(password)]);
  return { email, password, generada };
}

module.exports = { ROLES, hashPassword, verificarPassword, login, logout, usuarioDeToken, cambiarPassword, listar, crear, obtener, actualizar, eliminar, asegurarAdministrador };
