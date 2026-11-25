const fs = require('fs');
const path = require('path');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261114);
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

const PRODUCTOS = [
  ['AND-RUN-001', 'Andes Runner Pro',       'AndesRun', 'Runner Pro 2',   42,   'Running',   289.9, 10.0, 'Zapatilla de running con amortiguación reactiva para largas distancias.'],
  ['AND-RUN-002', 'Andes Runner Lite',      'AndesRun', 'Runner Lite',    41,   'Running',   219.9,  8.5, 'Modelo ligero de running para entrenamientos diarios.'],
  ['INT-URB-001', 'Inti Urban Classic',     'IntiSport','Urban Classic',  40,   'Urbana',    199.9,  8.0, 'Estilo urbano clásico, cómoda para todo el día.'],
  ['INT-URB-002', 'Inti Urban Street',      'IntiSport','Urban Street',   43,   'Urbana',    239.9,  6.5, 'Zapatilla urbana de suela gruesa y diseño llamativo.'],
  ['PAC-TRK-001', 'Pacha Trek Montaña',     'Pacha',    'Trek Montaña',   42,   'Trekking',  349.9,  6.0, 'Botín de trekking con suela de tacos para terrenos irregulares.'],
  ['PAC-TRK-002', 'Pacha Trail Ligera',     'Pacha',    'Trail Ligera',   41,   'Trekking',  319.9,  4.0, 'Zapatilla de trail ligera, secado rápido y buen agarre.'],
  ['KUN-BAS-001', 'Kuntur Basket Alto',     'Kuntur',   'Basket Alto',    44,   'Básquet',   379.9,  3.5, 'Caña alta con soporte de tobillo para básquet.'],
  ['KUN-FUT-001', 'Kuntur Futsal Turbo',    'Kuntur',   'Futsal Turbo',   40,   'Fútbol',    179.9,  3.0, 'Zapatilla de futsal con suela plana antideslizante.'],
  ['AND-CAS-001', 'Andes Casual Lona',      'AndesRun', 'Casual Lona',    39,   'Casual',    129.9,  2.5, 'Zapatilla casual de lona, ideal para uso diario.'],
  ['INT-SKT-001', 'Inti Skate Flat',        'IntiSport','Skate Flat',     38,   'Skate',     169.9,  2.0, 'Suela plana y refuerzos para skate.'],
  ['PAC-NIN-001', 'Pacha Kids Aventura',    'Pacha',    'Kids Aventura',  33,   'Niños',      99.9,  1.5, 'Zapatilla infantil resistente para jugar y explorar.'],
  ['KUN-ELE-001', 'Kuntur Elite Edición',   'Kuntur',   'Elite Edición',  42.5, 'Running',   459.9,  1.0, 'Edición especial de running con materiales premium.'],
];

const ESTACIONALIDAD = [-0.06, -0.10, 0.0, 0.03, 0.05, 0.0, 0.04, 0.02, 0.0, 0.05, 0.10, 0.20];
function totalObjetivo(t, mes) {
  const base = 22000 + 520 * t;
  const ruido = 1 + (rand() - 0.5) * 0.12;
  return Math.round(base * (1 + ESTACIONALIDAD[mes - 1]) * ruido * 100) / 100;
}

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
const pad = (n, l = 2) => String(n).padStart(l, '0');
function fmtFecha(y, m, d, hh, mm, ss) {
  return `${y}-${pad(m)}-${pad(d)} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
function inserts(tabla, columnas, filas, lote = 250) {
  const out = [];
  for (let i = 0; i < filas.length; i += lote) {
    const trozo = filas.slice(i, i + lote).map((f) => '  (' + f.join(', ') + ')');
    out.push(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES\n${trozo.join(',\n')};`);
  }
  return out.join('\n');
}

const csvFilas = [];
for (let t = 0; t < 24; t++) {
  const anio = 2023 + Math.floor(t / 12);
  const mes = (t % 12) + 1;
  csvFilas.push({ anio, mes, total: totalObjetivo(t, mes) });
}
const csv =
  '# DATOS FICTICIOS DE DEMOSTRACION - no corresponden a ventas reales.\n' +
  '# Columnas: anio (2000-2100), numero_mes (1-12), total_venta_mes (soles, >= 0).\n' +
  '# Las lineas que empiezan con # se ignoran al importar.\n' +
  'anio,numero_mes,total_venta_mes\n' +
  csvFilas.map((f) => `${f.anio},${f.mes},${f.total.toFixed(2)}`).join('\n') +
  '\n';

const productosDb = PRODUCTOS.map((p, i) => ({
  id: i + 1, sku: p[0], nombre: p[1], marca: p[2], modelo: p[3], talla: p[4],
  categoria: p[5], precio: p[6], peso: p[7], descripcion: p[8],
}));

function elegirProducto(mesIdx) {
  const pesos = productosDb.map((p, i) => p.peso * (1 + 0.25 * Math.sin(mesIdx * 0.7 + i)));
  const total = pesos.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < pesos.length; i++) {
    r -= pesos[i];
    if (r <= 0) return productosDb[i];
  }
  return productosDb[productosDb.length - 1];
}

const ventasGen = [];
for (let t = 24; t <= 46; t++) {
  const anio = 2023 + Math.floor(t / 12);
  const mes = (t % 12) + 1;
  const parcial = anio === 2026 && mes === 11; // noviembre 2026: mes en curso
  let objetivo = totalObjetivo(t, mes);
  if (parcial) objetivo *= 0.3;
  const diaMax = parcial ? 12 : new Date(anio, mes, 0).getDate();
  let acumulado = 0;
  while (acumulado < objetivo) {
    const prod = elegirProducto(t);
    const cantidad = [1, 1, 1, 1, 2, 2, 3][randInt(0, 6)];
    const importe = Math.round(prod.precio * cantidad * 100) / 100;
    const anulada = rand() < 0.015;
    ventasGen.push({
      fecha: fmtFecha(anio, mes, randInt(1, diaMax), randInt(9, 20), randInt(0, 59), randInt(0, 59)),
      estado: anulada ? 'anulada' : 'completada',
      prod, cantidad, importe,
    });
    if (!anulada) acumulado += importe;
  }
}
ventasGen.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

const filasProductos = productosDb.map((p) => {
  const stock = randInt(8, 60);
  return [p.id, q(p.sku), q(p.nombre), q(p.marca), q(p.modelo), p.talla.toFixed(1),
    q(p.categoria), q(p.descripcion), p.precio.toFixed(2), stock, q('2025-01-02 09:00:00')];
});
const filasVentas = [];
const filasDetalle = [];
ventasGen.forEach((v, i) => {
  const id = i + 1;
  const igv = Math.round(v.importe * 0.18 * 100) / 100;       // IGV 18 % sobre el subtotal
  const total = Math.round((v.importe + igv) * 100) / 100;
  filasVentas.push([id, q(v.fecha), q(v.estado), v.importe.toFixed(2), igv.toFixed(2), total.toFixed(2),
    v.estado === 'anulada' ? q(v.fecha) : 'NULL']);
  filasDetalle.push([id, id, v.prod.id, v.cantidad, v.prod.precio.toFixed(2), v.importe.toFixed(2)]);
});
const filasHistorial = csvFilas.map((f) => [f.anio, f.mes, f.total.toFixed(2), q('csv')]);

const sql = `-- =====================================================================
-- DATOS FICTICIOS DE DEMOSTRACIÓN (generado por herramientas/generar-datos-ejemplo.js)
-- Ninguna cifra, marca o modelo corresponde a una empresa real.
--
-- Contenido:
--   * ${productosDb.length} productos
--   * ${ventasGen.length} ventas (2025-01 a 2026-11; noviembre 2026 es un mes parcial)
--   * historial mensual importado 2023-01 a 2024-12 (mismo contenido que
--     datos/ventas_historicas.csv)
--
-- Uso:  mysql -u root -p < base_de_datos/datos-ejemplo.sql   (después de esquema.sql, sobre BD vacía)
-- =====================================================================

SET NAMES utf8mb4;
USE tienda_zapatillas;

SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

${inserts('productos', ['id', 'sku', 'nombre', 'marca', 'modelo', 'talla', 'categoria', 'descripcion', 'precio', 'stock', 'creado_en'], filasProductos)}

${inserts('ventas', ['id', 'fecha', 'estado', 'subtotal', 'igv', 'total', 'anulada_en'], filasVentas)}

${inserts('detalle_ventas', ['id', 'venta_id', 'producto_id', 'cantidad', 'precio_unitario', 'subtotal'], filasDetalle)}

${inserts('historial_ventas_mensuales', ['anio', 'mes', 'total_venta_mes', 'origen'], filasHistorial)}

SET SQL_MODE = @OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS = 1;
`;

fs.writeFileSync(path.join(__dirname, '../base_de_datos/datos-ejemplo.sql'), sql, 'utf8');
fs.writeFileSync(path.join(__dirname, '../datos/ventas_historicas.csv'), csv, 'utf8');
console.log(`datos-ejemplo.sql: ${productosDb.length} productos, ${ventasGen.length} ventas`);
console.log(`ventas_historicas.csv: ${csvFilas.length} meses`);
