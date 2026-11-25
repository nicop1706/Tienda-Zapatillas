const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad2 = (n) => String(n).padStart(2, '0');

/** 'AAAA-MM-DD' + 1 día (calendario UTC, sin efectos de zona horaria). */
function sumarDia(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 'AAAA-MM' -> { anio, mes } */
function parseClave(clave) {
  const [anio, mes] = clave.split('-').map(Number);
  return { anio, mes };
}
const clave = (anio, mes) => `${anio}-${pad2(mes)}`;

/** Número absoluto de mes (para restar/sumar meses fácilmente). */
const mesAbsoluto = (anio, mes) => anio * 12 + (mes - 1);
function desdeAbsoluto(n) {
  return { anio: Math.floor(n / 12), mes: (n % 12) + 1 };
}

/** Lista de claves 'AAAA-MM' entre dos claves (ambas inclusive). */
function rangoMeses(claveInicio, claveFin) {
  const a = parseClave(claveInicio);
  const b = parseClave(claveFin);
  const ini = mesAbsoluto(a.anio, a.mes);
  const fin = mesAbsoluto(b.anio, b.mes);
  const out = [];
  for (let n = ini; n <= fin; n++) {
    const { anio, mes } = desdeAbsoluto(n);
    out.push(clave(anio, mes));
  }
  return out;
}

function sumarMeses(claveBase, cantidad) {
  const { anio, mes } = parseClave(claveBase);
  const r = desdeAbsoluto(mesAbsoluto(anio, mes) + cantidad);
  return clave(r.anio, r.mes);
}

const etiquetaCorta = (c) => {
  const { anio, mes } = parseClave(c);
  return `${MESES_CORTO[mes - 1]} ${anio}`;
};
const etiquetaLarga = (c) => {
  const { anio, mes } = parseClave(c);
  return `${MESES_LARGO[mes - 1]} de ${anio}`;
};

module.exports = {
  sumarDia, parseClave, clave, mesAbsoluto, desdeAbsoluto, rangoMeses, sumarMeses,
  etiquetaCorta, etiquetaLarga, MESES_LARGO,
};
