/**
 * Portada de la pantalla de login.
 *   GET    /api/portada   -> { url } o { url: null }   (PÚBLICO: el login se muestra antes de iniciar sesión)
 *   PUT    /api/portada   -> cuerpo binario JPG/PNG/WebP (máx. 5 MB)      (solo administrador)
 *   DELETE /api/portada   -> vuelve a la ilustración por defecto            (solo administrador)
 */
const express = require('express');
const router = express.Router();
const images = require('../servicios/imagenesServicio');
const { ok } = require('../utilidades/respuesta');
const { AppError, asyncHandler } = require('../utilidades/errores');
const { requerirSesion, permitir } = require('../intermedios/autenticacion');

router.get('/', asyncHandler(async (req, res) => { ok(res, { url: await images.portadaUrl() }); }));

router.put('/', requerirSesion, permitir('administrador'),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw new AppError(400, 'Envía una imagen JPG, PNG o WebP de hasta 5 MB.', 'VALIDACION');
    }
    await images.guardarPortada(req.body);
    ok(res, { url: await images.portadaUrl() });
  }));

router.delete('/', requerirSesion, permitir('administrador'), asyncHandler(async (req, res) => {
  await images.quitarPortada();
  ok(res, { url: null });
}));

module.exports = router;
