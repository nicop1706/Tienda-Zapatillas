const router = require('express').Router();
const c = require('../controladores/prediccionControlador');

router.get('/history', c.historial);
router.post('/train', c.entrenar);
router.post('/predict', c.predecir);
router.post('/forecast', c.pronostico);
router.get('/log', c.registro);
router.get('/metrics', c.metricas);
router.post('/import', c.importar); // cuerpo: text/csv

module.exports = router;
