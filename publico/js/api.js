// Cliente de la API REST. Toda la comunicación con el backend pasa por aquí.

export class ApiError extends Error {
  constructor(mensaje, status = 0, codigo = 'ERROR', detalles = undefined) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

function construirUrl(ruta, query) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  const qs = params.toString();
  return qs ? `${ruta}?${qs}` : ruta;
}

async function solicitar(ruta, { metodo = 'GET', cuerpo, query, tipo = 'json' } = {}) {
  const opciones = { method: metodo, headers: { Accept: 'application/json' } };
  if (cuerpo !== undefined) {
    if (tipo === 'binario') {
      opciones.headers['Content-Type'] = cuerpo.type;
      opciones.body = cuerpo;
    } else if (tipo === 'csv') {
      opciones.headers['Content-Type'] = 'text/csv';
      opciones.body = cuerpo;
    } else {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(cuerpo);
    }
  }

  let resp;
  try {
    resp = await fetch(construirUrl(ruta, query), opciones);
  } catch (_) {
    throw new ApiError('No se pudo conectar con el servidor. Verifica que esté en ejecución.', 0, 'SIN_CONEXION');
  }

  let json = null;
  try { json = await resp.json(); } catch (_) { /* respuesta sin JSON */ }

  if (resp.status === 401 && !ruta.startsWith('/api/auth/login')) {
    location.replace('/inicio-sesion.html');
    throw new ApiError('Sesión expirada.', 401, 'NO_AUTENTICADO');
  }
  if (!resp.ok || !json || json.success !== true) {
    const e = (json && json.error) || {};
    throw new ApiError(e.mensaje || `Error inesperado del servidor (${resp.status}).`, resp.status, e.codigo, e.detalles);
  }
  return json; // { success, data, meta? }
}

export const api = {
  login: (email, password) => solicitar('/api/auth/login', { metodo: 'POST', cuerpo: { email, password } }),
  logout: () => solicitar('/api/auth/logout', { metodo: 'POST' }),
  yo: () => solicitar('/api/auth/me'),
  cambiarPassword: (actual, nueva) => solicitar('/api/auth/password', { metodo: 'POST', cuerpo: { actual, nueva } }),

  usuarios: () => solicitar('/api/users'),
  crearUsuario: (d) => solicitar('/api/users', { metodo: 'POST', cuerpo: d }),
  editarUsuario: (id, d) => solicitar(`/api/users/${id}`, { metodo: 'PUT', cuerpo: d }),
  eliminarUsuario: (id) => solicitar(`/api/users/${id}`, { metodo: 'DELETE' }),

  resumen: (q) => solicitar('/api/dashboard/resumen', { query: q }),
  ventasMensualesTotales: (q) => solicitar('/api/dashboard/ventas-mensuales', { query: q }),
  mensualTop5: (q) => solicitar('/api/sales/monthly', { query: q }),
  categoriasVentas: (q) => solicitar('/api/dashboard/categorias', { query: q }),
  stockBajo: (umbral) => solicitar('/api/dashboard/stock-bajo', { query: { umbral } }),
  tendencias: () => solicitar('/api/dashboard/tendencias'),
  actividad: () => solicitar('/api/dashboard/actividad'),

  productos: (q) => solicitar('/api/products', { query: q }),
  categorias: () => solicitar('/api/products/categories'),
  imagenes: () => solicitar('/api/products/imagenes'),
  subirFoto: (id, blob) => solicitar(`/api/products/${id}/imagen`, { metodo: 'PUT', cuerpo: blob, tipo: 'binario' }),
  portada: () => solicitar('/api/portada'),
  subirPortada: (blob) => solicitar('/api/portada', { metodo: 'PUT', cuerpo: blob, tipo: 'binario' }),
  quitarPortada: () => solicitar('/api/portada', { metodo: 'DELETE' }),
  quitarFoto: (id) => solicitar(`/api/products/${id}/imagen`, { metodo: 'DELETE' }),
  crearProducto: (d) => solicitar('/api/products', { metodo: 'POST', cuerpo: d }),
  editarProducto: (id, d) => solicitar(`/api/products/${id}`, { metodo: 'PUT', cuerpo: d }),
  eliminarProducto: (id) => solicitar(`/api/products/${id}`, { metodo: 'DELETE' }),

  ventas: (q) => solicitar('/api/sales', { query: q }),
  venta: (id) => solicitar(`/api/sales/${id}`),
  registrarVenta: (d) => solicitar('/api/sales', { metodo: 'POST', cuerpo: d }),
  anularVenta: (id) => solicitar(`/api/sales/${id}/anular`, { metodo: 'PATCH' }),

  reporte: (q) => solicitar('/api/reports/summary', { query: q }),

  predHistorial: () => solicitar('/api/predictions/history'),
  predEntrenar: (d = {}) => solicitar('/api/predictions/train', { metodo: 'POST', cuerpo: d }),
  predPredecir: (periodo) => solicitar('/api/predictions/predict', { metodo: 'POST', cuerpo: { periodo } }),
  predPronostico: (meses) => solicitar('/api/predictions/forecast', { metodo: 'POST', cuerpo: { meses } }),
  predMetricas: () => solicitar('/api/predictions/metrics'),
  predRegistro: () => solicitar('/api/predictions/log'),
  predImportar: (csv) => solicitar('/api/predictions/import', { metodo: 'POST', cuerpo: csv, tipo: 'csv' }),
};
