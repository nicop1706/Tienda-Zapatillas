const PELIGROSOS = /^[=+\-@\t\r]/;

function celda(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : '';
  let t = String(valor);
  if (PELIGROSOS.test(t)) t = `'${t}`;
  if (/[",\n\r]/.test(t)) t = `"${t.replace(/"/g, '""')}"`;
  return t;
}

function aCsv(columnas, filas) {
  const cab = columnas.map((c) => celda(c.titulo)).join(',');
  const cuerpo = filas.map((f) => columnas.map((c) => celda(f[c.campo])).join(','));
  return '﻿' + [cab, ...cuerpo].join('\r\n') + '\r\n';
}

function enviarCsv(res, nombreArchivo, columnas, filas) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(aCsv(columnas, filas));
}

module.exports = { aCsv, enviarCsv, celda };
