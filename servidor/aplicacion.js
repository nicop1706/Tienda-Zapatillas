const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { notFound, errorHandler } = require('./intermedios/manejadorErrores');
const { requerirSesion, permitir, permitirEscritura } = require('./intermedios/autenticacion');

function crearApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"], // atributos style en gráficos/barras
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': null, // la app se sirve por http://localhost
      },
    },
  }));

  // CORS: por defecto solo mismo origen (frontend servido por este servidor).
  // Para permitir otros orígenes: CORS_ORIGINS=http://localhost:5173,https://midominio.com
  const origenes = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origenes.length) {
    app.use('/api', cors({ origin: origenes, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '200kb' }));

  app.get('/api/health', (req, res) => res.json({ success: true, data: { estado: 'ok' } }));
  app.use('/api/auth', require('./rutas/autenticacionRutas'));
  app.use('/api/portada', require('./rutas/portadaRutas'));   // GET público; PUT/DELETE solo administrador
  // Todo lo demás exige sesión; los permisos dependen del rol:
  //   administrador: todo · vendedor: ventas (registrar/anular) y consulta · analista: predicciones y reportes
  app.use('/api/dashboard', requerirSesion, require('./rutas/panelRutas'));
  app.use('/api/products', requerirSesion, permitirEscritura('administrador'), require('./rutas/productosRutas'));
  app.use('/api/sales', requerirSesion, permitirEscritura('administrador', 'vendedor'), require('./rutas/ventasRutas'));
  app.use('/api/predictions', requerirSesion, permitirEscritura('administrador', 'analista'), require('./rutas/prediccionRutas'));
  app.use('/api/reports', requerirSesion, permitir('administrador', 'analista'), require('./rutas/reportesRutas'));
  app.use('/api/users', requerirSesion, permitir('administrador'), require('./rutas/usuariosRutas'));
  app.use('/api', notFound);

  // Chart.js se sirve localmente (sin CDN): la app funciona sin conexión a Internet
  app.get('/librerias/chart.umd.js', (req, res) => {
    res.sendFile(path.join(__dirname, '../node_modules/chart.js/dist/chart.umd.js'));
  });
  // Fuente Inter incluida localmente (sin Google Fonts)
  app.get('/librerias/fuentes/:archivo', (req, res, next) => {
    if (!/^inter-(latin|latin-ext)-wght-normal\.woff2$/.test(req.params.archivo)) return next();
    res.sendFile(path.join(__dirname, '../node_modules/@fontsource-variable/inter/files', req.params.archivo));
  });
  // HTML/JS/CSS se revalidan siempre (no-cache): así una actualización del sistema nunca se
  // mezcla con archivos viejos guardados por el navegador. Las fuentes e imágenes sí se cachean.
  app.use(express.static(path.join(__dirname, '../publico'), {
    setHeaders(res, ruta) {
      if (/\.(html|js|css)$/i.test(ruta)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.use(errorHandler);
  return app;
}

module.exports = { crearApp };
