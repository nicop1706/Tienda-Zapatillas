const express = require('express');
const router = express.Router();
const c = require('../controladores/productosControlador');

router.get('/', c.listar);
router.get('/top-selling', c.topSelling); // debe ir antes de /:id
router.get('/categories', c.categorias);
router.get('/imagenes', c.imagenes);      // idem: fotos disponibles en publico/imagenes/productos
router.get('/export.csv', c.exportar);     // idem
router.post('/', c.crear);
router.get('/:id', c.obtener);
// Foto del producto: cuerpo binario (JPG/PNG/WebP, máx. 3 MB); solo administrador (lo exige el montaje en app.js)
router.put('/:id/imagen', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }), c.subirImagen);
router.delete('/:id/imagen', c.quitarImagen);
router.put('/:id', c.actualizar);
router.delete('/:id', c.eliminar);

module.exports = router;
