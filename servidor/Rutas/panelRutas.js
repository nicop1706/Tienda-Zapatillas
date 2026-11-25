const router = require('express').Router();
const c = require('../controladores/panelControlador');

router.get('/resumen', c.resumen);
router.get('/ventas-mensuales', c.ventasMensuales);
router.get('/categorias', c.categorias);
const reports = require('../servicios/reportesServicio');
const { ok } = require('../utilidades/respuesta');
const { asyncHandler } = require('../utilidades/errores');
router.get('/tendencias', asyncHandler(async (req, res) => ok(res, await reports.tendencias())));
router.get('/actividad', asyncHandler(async (req, res) => ok(res, await reports.actividad())));
router.get('/stock-bajo', c.stockBajo);

module.exports = router;
