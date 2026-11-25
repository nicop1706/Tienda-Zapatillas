const router = require('express').Router();
const c = require('../controladores/ventasControlador');

router.get('/', c.listar);
router.post('/', c.registrar);
router.get('/monthly', c.mensual); // debe ir antes de /:id
router.get('/export.csv', c.exportar);
router.get('/:id', c.obtener);
router.patch('/:id/anular', c.anular);

module.exports = router;
