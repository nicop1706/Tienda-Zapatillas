const h = require('./ayudantes'); // debe ir primero
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { pool, close } = require('../servidor/configuracion/baseDatos');

let api;
before(async () => { await h.reiniciarBd(); api = await h.iniciarServidor(); });
after(async () => { await api.cerrar(); await close(); await h.eliminarBd(); });

describe('Autenticación', () => {
  test('toda la API (salvo login) exige sesión: 401 sin cookie', async () => {
    const anon = api.sinSesion();
    for (const ruta of ['/api/products', '/api/sales', '/api/dashboard/resumen', '/api/predictions/history', '/api/reports/summary', '/api/users', '/api/auth/me']) {
      const r = await anon.get(ruta);
      assert.equal(r.status, 401, ruta);
      assert.equal(r.body.success, false);
    }
    assert.equal((await anon.post('/api/sales', { items: [] })).status, 401);
  });

  test('login correcto crea cookie HttpOnly + SameSite=Strict; el token no se guarda en claro', async () => {
    const anon = api.sinSesion();
    const r = await anon.post('/api/auth/login', { email: 'administrador@test.local', password: 'ClavePrueba123' });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.ok(!('password_hash' in r.body.data), 'no debe exponer el hash');
    const token = cookie.split(';')[0].split('=')[1];
    const [filas] = await pool.query('SELECT token_hash FROM sesiones');
    assert.ok(filas.length >= 1);
    assert.ok(filas.every((f) => f.token_hash !== token && f.token_hash.length === 64));
  });

  test('credenciales incorrectas -> 401 con el mismo mensaje exista o no el correo', async () => {
    const anon = api.sinSesion();
    const a = await anon.post('/api/auth/login', { email: 'administrador@test.local', password: 'mala' });
    const b = await anon.post('/api/auth/login', { email: 'nadie@test.local', password: 'mala' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.mensaje, b.body.error.mensaje);
    assert.equal((await anon.post('/api/auth/login', {})).status, 400);
  });

  test('las contraseñas se guardan con scrypt y sal (no en claro)', async () => {
    const [[u]] = await pool.query("SELECT password_hash FROM usuarios WHERE email = 'administrador@test.local'");
    assert.match(u.password_hash, /^scrypt\$\d+\$\d+\$\d+\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    assert.ok(!u.password_hash.includes('ClavePrueba123'));
  });

  test('logout invalida la sesión', async () => {
    const c = await api.conRol('vendedor');
    assert.equal((await c.get('/api/auth/me')).status, 200);
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  test('sesión expirada o usuario desactivado -> 401', async () => {
    const c = await api.conRol('analista');
    await pool.query("UPDATE sesiones s JOIN usuarios u ON u.id = s.usuario_id SET s.expira_en = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE u.email = 'analista@test.local'");
    assert.equal((await c.get('/api/auth/me')).status, 401);
    const c2 = await api.conRol('analista');
    await pool.query("UPDATE usuarios SET activo = 0 WHERE email = 'analista@test.local'");
    assert.equal((await c2.get('/api/auth/me')).status, 401);
    const anon = api.sinSesion();
    assert.equal((await anon.post('/api/auth/login', { email: 'analista@test.local', password: 'ClavePrueba123' })).status, 403);
    await pool.query("UPDATE usuarios SET activo = 1 WHERE email = 'analista@test.local'");
  });

  test('límite de intentos fallidos de login (429)', async () => {
    const anon = api.sinSesion();
    let ultimo;
    for (let i = 0; i < 9; i++) ultimo = await anon.post('/api/auth/login', { email: 'bloqueo@test.local', password: 'x' });
    assert.equal(ultimo.status, 429);
  });

  test('cambiar contraseña exige la actual y una nueva de 8+ caracteres', async () => {
    const c = await api.conRol('vendedor');
    assert.equal((await c.post('/api/auth/password', { actual: 'incorrecta', nueva: 'NuevaClave123' })).status, 400);
    assert.equal((await c.post('/api/auth/password', { actual: 'ClavePrueba123', nueva: 'corta' })).status, 400);
    assert.equal((await c.post('/api/auth/password', { actual: 'ClavePrueba123', nueva: 'NuevaClave123' })).status, 200);
    const anon = api.sinSesion();
    assert.equal((await anon.post('/api/auth/login', { email: 'vendedor@test.local', password: 'ClavePrueba123' })).status, 401);
    assert.equal((await anon.post('/api/auth/login', { email: 'vendedor@test.local', password: 'NuevaClave123' })).status, 200);
    await pool.query("UPDATE usuarios SET password_hash = (SELECT password_hash FROM (SELECT password_hash FROM usuarios WHERE email='administrador@test.local') x) WHERE email = 'vendedor@test.local'");
  });
});

describe('Roles y permisos', () => {
  let vendedor; let analista;
  before(async () => { vendedor = await api.conRol('vendedor'); analista = await api.conRol('analista'); });

  test('vendedor: consulta productos y registra ventas, pero no edita productos ni ve predicción/reportes/usuarios', async () => {
    const p = (await api.post('/api/products', h.productoValido({ sku: 'ROL-1', stock: '10' }))).body.data;
    assert.equal((await vendedor.get('/api/products')).status, 200);
    assert.equal((await vendedor.post('/api/products', h.productoValido({ sku: 'ROL-2' }))).status, 403);
    assert.equal((await vendedor.put(`/api/products/${p.id}`, h.productoValido({ sku: 'ROL-1' }))).status, 403);
    assert.equal((await vendedor.del(`/api/products/${p.id}`)).status, 403);
    const v = await vendedor.post('/api/sales', { items: [{ producto_id: p.id, cantidad: 1 }] });
    assert.equal(v.status, 201);
    assert.equal((await vendedor.patch(`/api/sales/${v.body.data.id}/anular`)).status, 200);
    assert.equal((await vendedor.post('/api/predictions/train', {})).status, 403);
    assert.equal((await vendedor.get('/api/reports/summary')).status, 403);
    assert.equal((await vendedor.get('/api/users')).status, 403);
  });

  test('analista: consulta ventas y usa predicción/reportes, pero no registra ventas ni edita productos', async () => {
    const p = (await api.post('/api/products', h.productoValido({ sku: 'ROL-3', stock: '10' }))).body.data;
    assert.equal((await analista.get('/api/sales')).status, 200);
    assert.equal((await analista.get('/api/reports/summary')).status, 200);
    assert.equal((await analista.get('/api/predictions/history')).status, 200);
    assert.equal((await analista.post('/api/sales', { items: [{ producto_id: p.id, cantidad: 1 }] })).status, 403);
    assert.equal((await analista.post('/api/products', h.productoValido({ sku: 'ROL-4' }))).status, 403);
    assert.equal((await analista.get('/api/users')).status, 403);
  });
});

describe('Usuarios (solo administrador)', () => {
  test('crea, edita, valida y elimina; correo único; contraseña mínima', async () => {
    const r = await api.post('/api/users', { nombre: 'Ana López', email: 'Ana@Test.Local', password: 'ClaveSegura1', rol: 'vendedor' });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.email, 'ana@test.local');           // se normaliza a minúsculas
    assert.ok(!('password_hash' in r.body.data));
    assert.equal((await api.post('/api/users', { nombre: 'Otra', email: 'ana@test.local', password: 'ClaveSegura1', rol: 'vendedor' })).status, 409);
    assert.equal((await api.post('/api/users', { nombre: 'X', email: 'malcorreo', password: 'ClaveSegura1', rol: 'gerente' })).status, 400);
    assert.equal((await api.post('/api/users', { nombre: 'Corta', email: 'c@test.local', password: '123', rol: 'vendedor' })).status, 400);
    const e = await api.put(`/api/users/${r.body.data.id}`, { rol: 'analista', activo: false });
    assert.equal(e.status, 200);
    assert.equal(e.body.data.rol, 'analista');
    assert.equal(e.body.data.activo, false);
    assert.equal((await api.del(`/api/users/${r.body.data.id}`)).status, 200);
    assert.equal((await api.del(`/api/users/${r.body.data.id}`)).status, 404);
  });

  test('protege al último administrador y no permite auto-eliminarse', async () => {
    const lista = (await api.get('/api/users')).body.data;
    const admin = lista.find((u) => u.email === 'administrador@test.local');
    assert.equal((await api.del(`/api/users/${admin.id}`)).status, 409);
    assert.equal((await api.put(`/api/users/${admin.id}`, { activo: false })).status, 409);
    assert.equal((await api.put(`/api/users/${admin.id}`, { rol: 'vendedor' })).status, 409);
  });
});
