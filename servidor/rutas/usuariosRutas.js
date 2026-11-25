const router = require('express').Router();
const auth = require('../servicios/autenticacionServicio');
const { ok } = require('../utilidades/respuesta');
const { asyncHandler } = require('../utilidades/errores');
const { parseId } = require('../utilidades/validadores');

// (el router se monta con requerirSesion + permitir('administrador'))
router.get('/', asyncHandler(async (req, res) => ok(res, await auth.listar())));
router.post('/', asyncHandler(async (req, res) => ok(res, await auth.crear(req.body || {}), undefined, 201)));
router.put('/:id', asyncHandler(async (req, res) => ok(res, await auth.actualizar(parseId(req.params.id), req.body || {}, req.usuario.id))));
router.delete('/:id', asyncHandler(async (req, res) => {
  await auth.eliminar(parseId(req.params.id), req.usuario.id);
  ok(res, { eliminado: true });
}));

module.exports = router;
