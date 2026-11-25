/**
 * Fotos de productos. No se guardan en la base de datos: basta con dejar un archivo en
 * publico/imagenes/productos/ cuyo nombre sea el SKU del producto (p. ej. AND-RUN-001.jpg)
 * o su ID (p. ej. 3.png). Formatos: jpg, jpeg, png, webp. Si un producto no tiene foto,
 * la interfaz muestra la ilustración por defecto.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../configuracion/baseDatos');

const CARPETA = path.join(__dirname, '../../publico/imagenes/productos');
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Devuelve { "<id>": "/imagenes/productos/archivo.ext?v=...", "<sku>": "..." } solo de productos con foto. */
async function listar() {
  let archivos = [];
  try { archivos = await fs.promises.readdir(CARPETA); } catch (_) { return {}; }
  const porNombre = new Map(); // nombre sin extensión (minúsculas) -> archivo
  for (const f of archivos) {
    const ext = path.extname(f).toLowerCase();
    if (!EXT.has(ext)) continue;
    const base = path.basename(f, path.extname(f)).toLowerCase();
    if (!porNombre.has(base)) porNombre.set(base, f);
  }
  if (!porNombre.size) return {};
  const [filas] = await pool.query('SELECT id, sku FROM productos');
  const salida = {};
  for (const { id, sku } of filas) {
    const f = porNombre.get(String(sku).toLowerCase()) || porNombre.get(String(id));
    if (!f) continue;
    let v = 0;
    try { v = Math.floor((await fs.promises.stat(path.join(CARPETA, f))).mtimeMs); } catch (_) { /* sin versión */ }
    const url = `/imagenes/productos/${encodeURIComponent(f)}?v=${v}`;
    salida[String(id)] = url;
    salida[String(sku)] = url;
  }
  return salida;
}

const { AppError } = require('../utilidades/errores');

/** Tipo real de imagen según los primeros bytes (no se confía en el nombre ni en el Content-Type). */
function detectarTipo(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Borra todas las fotos del producto (por SKU o por ID, cualquier extensión o mayúsculas). */
async function borrarFotosDe(id, sku) {
  let archivos = [];
  try { archivos = await fs.promises.readdir(CARPETA); } catch (_) { return; }
  const nombres = new Set([String(id), String(sku).toLowerCase()]);
  for (const f of archivos) {
    const ext = path.extname(f).toLowerCase();
    if (EXT.has(ext) && nombres.has(path.basename(f, path.extname(f)).toLowerCase())) {
      await fs.promises.rm(path.join(CARPETA, f), { force: true });
    }
  }
}

async function productoOError(id) {
  const [[p]] = await pool.query('SELECT id, sku FROM productos WHERE id = ?', [id]);
  if (!p) throw new AppError(404, 'Producto no encontrado.', 'NO_ENCONTRADO');
  return p;
}

/** Guarda la foto como <id>.<ext>, reemplazando cualquier foto anterior del producto. */
async function guardar(id, buffer) {
  const p = await productoOError(id);
  const tipo = detectarTipo(buffer);
  if (!tipo) throw new AppError(400, 'El archivo no es una imagen JPG, PNG o WebP válida.', 'VALIDACION');
  await fs.promises.mkdir(CARPETA, { recursive: true });
  const destino = path.join(CARPETA, `${p.id}.${tipo.ext}`);
  const tmp = `${destino}.tmp`;
  await fs.promises.writeFile(tmp, buffer);
  await borrarFotosDe(p.id, p.sku);
  await fs.promises.rename(tmp, destino);
  return { archivo: `${p.id}.${tipo.ext}` };
}

async function quitar(id) {
  const p = await productoOError(id);
  await borrarFotosDe(p.id, p.sku);
}

/** Para borrar la foto al eliminar el producto (no falla si no existe). */
async function quitarSiExiste(id, sku) { try { await borrarFotosDe(id, sku); } catch (_) { /* no crítico */ } }

// ---------------------------------------------------------------------------
// Portada de la pantalla de login (una sola imagen para todo el sistema)
// ---------------------------------------------------------------------------
const CARPETA_PORTADA = path.join(__dirname, '../../publico/imagenes/portada');

async function archivosPortada() {
  try { return (await fs.promises.readdir(CARPETA_PORTADA)).filter((f) => /^portada\.(jpe?g|png|webp)$/i.test(f)); }
  catch (_) { return []; }
}

/** URL pública de la portada actual (con versión para evitar caché) o null si no hay. */
async function portadaUrl() {
  const [f] = await archivosPortada();
  if (!f) return null;
  let v = 0;
  try { v = Math.floor((await fs.promises.stat(path.join(CARPETA_PORTADA, f))).mtimeMs); } catch (_) { /* sin versión */ }
  return `/imagenes/portada/${f}?v=${v}`;
}

async function guardarPortada(buffer) {
  const tipo = detectarTipo(buffer);
  if (!tipo) throw new AppError(400, 'El archivo no es una imagen JPG, PNG o WebP válida.', 'VALIDACION');
  await fs.promises.mkdir(CARPETA_PORTADA, { recursive: true });
  const destino = path.join(CARPETA_PORTADA, `portada.${tipo.ext}`);
  await fs.promises.writeFile(`${destino}.tmp`, buffer);
  await quitarPortada();
  await fs.promises.rename(`${destino}.tmp`, destino);
}

async function quitarPortada() {
  for (const f of await archivosPortada()) await fs.promises.rm(path.join(CARPETA_PORTADA, f), { force: true });
}

module.exports = { listar, guardar, quitar, quitarSiExiste, detectarTipo, CARPETA, portadaUrl, guardarPortada, quitarPortada, CARPETA_PORTADA };
