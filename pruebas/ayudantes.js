/**
 * Utilidades de pruebas. Las pruebas SIEMPRE usan una base de datos distinta (DB_NAME_TEST, que debe
 * terminar en «_test») y una carpeta temporal para el modelo; nunca tocan los datos reales.
 *
 * IMPORTANTE: este archivo debe cargarse ANTES que cualquier módulo de servidor/.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

const NOMBRE_TEST = process.env.DB_NAME_TEST || 'tienda_zapatillas_test';
if (!/^[A-Za-z0-9_]*_test$/.test(NOMBRE_TEST)) {
  throw new Error('DB_NAME_TEST debe terminar en «_test» para proteger la base real.');
}
process.env.DB_NAME = NOMBRE_TEST;
process.env.MODEL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'modelo-test-'));

const { conexionAdmin, leerSql } = require('../herramientas/biblioteca/ejecutorSql');

/** Recrea la base de pruebas vacía desde esquema.sql. */
async function reiniciarBd() {
  const conn = await conexionAdmin();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${NOMBRE_TEST}\``);
    await conn.query(leerSql('esquema.sql', NOMBRE_TEST));
    const usuario = process.env.DB_USER;
    if (usuario && usuario !== (process.env.DB_ADMIN_USER || 'root')) {
      await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${NOMBRE_TEST}\`.* TO ?@?`, [usuario, 'localhost']);
    }
  } finally {
    await conn.end();
  }
}

async function eliminarBd() {
  const conn = await conexionAdmin();
  try { await conn.query(`DROP DATABASE IF EXISTS \`${NOMBRE_TEST}\``); } finally { await conn.end(); }
}

/** Arranca la app en un puerto libre. El cliente por defecto ya tiene sesión de ADMINISTRADOR. */
async function iniciarServidor() {
  const { crearApp } = require('../servidor/aplicacion');
  const authService = require('../servidor/servicios/autenticacionServicio');
  const servidor = await new Promise((resolve) => { const s = crearApp().listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  function cliente(cookie) {
    const c = { cookie };
    c.pedir = async (metodo, ruta, cuerpo, tipo = 'json') => {
      const opc = { method: metodo, headers: {} };
      if (c.cookie) opc.headers.Cookie = c.cookie;
      if (cuerpo !== undefined) {
        if (tipo === 'binario') { opc.headers['Content-Type'] = cuerpo.mime; opc.body = cuerpo.datos; }   // { datos: Buffer, mime }
        else {
          opc.headers['Content-Type'] = tipo === 'csv' ? 'text/csv' : 'application/json';
          opc.body = tipo === 'csv' ? cuerpo : JSON.stringify(cuerpo);
        }
      }
      const r = await fetch(base + ruta, opc);
      let json = null;
      try { json = await r.json(); } catch (_) { /* sin cuerpo JSON */ }
      return { status: r.status, body: json, headers: r.headers };
    };
    c.get = (r) => c.pedir('GET', r);
    c.post = (r, b) => c.pedir('POST', r, b);
    c.put = (r, b) => c.pedir('PUT', r, b);
    c.patch = (r, b) => c.pedir('PATCH', r, b);
    c.del = (r) => c.pedir('DELETE', r);
    return c;
  }

  /** Crea (si no existe) un usuario con ese rol y devuelve un cliente con su sesión iniciada. */
  async function conRol(rol) {
    const email = `${rol}@test.local`;
    const clave = 'ClavePrueba123';
    const existe = (await authService.listar()).find((u) => u.email === email);
    if (!existe) await authService.crear({ nombre: `Usuario ${rol}`, email, password: clave, rol });
    const anon = cliente(null);
    const r = await anon.post('/api/auth/login', { email, password: clave });
    if (r.status !== 200) throw new Error(`No se pudo iniciar sesión de prueba (${rol}): ${r.status}`);
    return cliente(r.headers.get('set-cookie').split(';')[0]);
  }

  const admin = await conRol('administrador');
  return {
    base,
    pedir: admin.pedir,
    get: admin.get, post: admin.post, put: admin.put, patch: admin.patch, del: admin.del,
    cookie: () => admin.cookie,
    sinSesion: () => cliente(null),
    conRol,
    /** Reinicia la BD (borra también los usuarios) y vuelve a iniciar la sesión de administrador. */
    reiniciar: async () => { await reiniciarBd(); const nuevo = await conRol('administrador'); admin.cookie = nuevo.cookie; },
    cerrar: () => new Promise((resolve) => servidor.close(resolve)),
  };
}

const productoValido = (extra = {}) => ({
  sku: 'TST-001', nombre: 'Zapatilla de prueba', marca: 'Marca', modelo: 'Modelo',
  talla: '42', categoria: 'Running', precio: '100.00', stock: '10', ...extra,
});

module.exports = { reiniciarBd, eliminarBd, iniciarServidor, productoValido, NOMBRE_TEST };
