/** Error controlado de la aplicación: se devuelve al cliente con su mensaje. */
class AppError extends Error {
  constructor(status, mensaje, codigo = 'ERROR', detalles = undefined) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, asyncHandler };
