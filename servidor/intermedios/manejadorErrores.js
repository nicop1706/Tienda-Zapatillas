const { AppError } = require('../utilidades/errores');

function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: { codigo: 'RUTA_NO_ENCONTRADA', mensaje: `La ruta ${req.method} ${req.originalUrl.split('?')[0]} no existe.` },
  });
}

/** Manejador centralizado: nunca expone mensajes internos, SQL ni credenciales. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let codigo = 'ERROR_INTERNO';
  let mensaje = 'Ocurrió un error interno. Inténtalo nuevamente más tarde.';
  let detalles;

  if (err instanceof AppError) {
    ({ status, codigo, message: mensaje, detalles } = err);
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400; codigo = 'JSON_INVALIDO'; mensaje = 'El cuerpo de la solicitud no es un JSON válido.';
  } else if (err && err.type === 'entity.too.large') {
    status = 413; codigo = 'CUERPO_DEMASIADO_GRANDE'; mensaje = 'El cuerpo de la solicitud supera el tamaño permitido.';
  } else if (err && err.code === 'ER_DUP_ENTRY') {
    status = 409; codigo = 'DUPLICADO'; mensaje = 'Ya existe un registro con esos datos únicos.';
  } else if (err && (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED')) {
    status = 409; codigo = 'REGISTRO_EN_USO'; mensaje = 'No se puede eliminar: el registro está en uso por otros datos.';
  } else if (err && ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ENOTFOUND', 'ETIMEDOUT'].includes(err.code)) {
    status = 503; codigo = 'BASE_DE_DATOS_NO_DISPONIBLE';
    mensaje = 'No se pudo conectar con la base de datos. Verifica que MySQL esté activo y la configuración del archivo .env.';
  }

  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  const error = { codigo, mensaje };
  if (detalles !== undefined) error.detalles = detalles;
  res.status(status).json({ success: false, error });
}

module.exports = { notFound, errorHandler };
