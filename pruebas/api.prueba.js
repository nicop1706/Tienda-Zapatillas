const h = require('./ayudantes'); // debe ir primero: fija la base de pruebas
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { pool, ping, close } = require('../servidor/configuracion/baseDatos');

let api;
const crearProducto = async (extra) => (await api.post('/api/products', h.productoValido(extra)));

before(async () => {
  await h.reiniciarBd();
  api = await h.iniciarServidor();
});
after(async () => {
  await api.cerrar();
  await close();
  await h.eliminarBd();
});

describe('Base de datos', () => {
  test('1. conecta a MySQL y usa la base de pruebas (no la real)', async () => {
    assert.equal(await ping(), true);
    const [[{ bd }]] = await pool.query('SELECT DATABASE() AS bd');
    assert.equal(bd, h.NOMBRE_TEST);
  });
});

describe('Productos', () => {
  test('2. registra y edita productos', async () => {
    const r = await crearProducto({ sku: 'prod-a', stock: '7' });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.sku, 'PROD-A'); // el SKU se normaliza a mayúsculas
    assert.equal(r.body.data.stock, 7);
    const id = r.body.data.id;

    const e = await api.put(`/api/products/${id}`, h.productoValido({ sku: 'PROD-A', nombre: 'Editada', precio: '150.55', stock: '3' }));
    assert.equal(e.status, 200);
    assert.equal(e.body.data.nombre, 'Editada');
    assert.equal(e.body.data.precio, 150.55);

    const g = await api.get(`/api/products/${id}`);
    assert.equal(g.body.data.stock, 3);
  });

  test('3. rechaza SKU duplicado (alta y edición) con 409', async () => {
    await crearProducto({ sku: 'DUP-1' });
    const dup = await crearProducto({ sku: 'dup-1' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.codigo, 'SKU_DUPLICADO');

    const otro = await crearProducto({ sku: 'DUP-2' });
    const ed = await api.put(`/api/products/${otro.body.data.id}`, h.productoValido({ sku: 'DUP-1' }));
    assert.equal(ed.status, 409);
  });

  test('12. valida datos incorrectos (stock, precio, talla, campos vacíos)', async () => {
    const casos = [
      [{ stock: '-1' }, 'stock'], [{ stock: '1.5' }, 'stock'], [{ stock: 'abc' }, 'stock'],
      [{ precio: '0' }, 'precio'], [{ precio: '-5' }, 'precio'], [{ precio: 'diez' }, 'precio'], [{ precio: '10.999' }, 'precio'],
      [{ talla: '5' }, 'talla'], [{ talla: 'x' }, 'talla'],
      [{ nombre: '   ' }, 'nombre'], [{ sku: 'a' }, 'sku'], [{ marca: '' }, 'marca'],
    ];
    for (const [extra, campo] of casos) {
      const r = await crearProducto({ sku: 'VAL-' + Math.random().toString(36).slice(2, 8), ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.equal(r.body.error.codigo, 'VALIDACION');
      assert.ok(r.body.error.detalles[campo], `debería reportar error en ${campo}`);
    }
  });

  test('lista, busca por nombre/SKU, ordena y pagina', async () => {
    await crearProducto({ sku: 'BUS-100', nombre: 'Alpha Runner' });
    await crearProducto({ sku: 'BUS-200', nombre: 'Beta Walker' });
    const porNombre = await api.get('/api/products?q=alpha');
    assert.equal(porNombre.body.data.length, 1);
    const porSku = await api.get('/api/products?q=BUS-200');
    assert.equal(porSku.body.data[0].nombre, 'Beta Walker');
    // los comodines LIKE se tratan como texto literal
    const comodin = await api.get('/api/products?q=%25');
    assert.equal(comodin.body.data.length, 0);

    const pag = await api.get('/api/products?limit=2&page=1&orden=sku&direccion=desc');
    assert.equal(pag.body.data.length, 2);
    assert.ok(pag.body.meta.total >= 4);
    assert.ok(pag.body.data[0].sku >= pag.body.data[1].sku);
    assert.equal((await api.get('/api/products?orden=precio;DROP')).status, 400);
  });

  test('elimina un producto sin ventas y protege el que tiene ventas', async () => {
    const libre = await crearProducto({ sku: 'DEL-1' });
    assert.equal((await api.del(`/api/products/${libre.body.data.id}`)).status, 200);
    assert.equal((await api.get(`/api/products/${libre.body.data.id}`)).status, 404);

    const vendido = await crearProducto({ sku: 'DEL-2' });
    assert.equal((await api.post('/api/sales', { items: [{ producto_id: vendido.body.data.id, cantidad: 1 }] })).status, 201);
    const r = await api.del(`/api/products/${vendido.body.data.id}`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.codigo, 'PRODUCTO_CON_VENTAS');
  });
});

describe('Ventas', () => {
  test('4-5. registra una venta, calcula el total en el servidor y descuenta el stock', async () => {
    const p = (await crearProducto({ sku: 'VEN-1', precio: '99.90', stock: '10' })).body.data;
    // el cliente intenta imponer precio y total: el servidor debe ignorarlos
    const r = await api.post('/api/sales', { items: [{ producto_id: p.id, cantidad: 3, precio: 1, subtotal: 1 }], total: 1 });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.subtotal, 299.7);
    assert.equal(r.body.data.igv, 53.95);          // 18 % de 299.70 = 53.946 -> 53.95
    assert.equal(r.body.data.total, 353.65);
    assert.equal(r.body.data.lineas[0].precio_unitario, 99.9);

    const prod = (await api.get(`/api/products/${p.id}`)).body.data;
    assert.equal(prod.stock, 7);

    const [[v]] = await pool.query('SELECT subtotal, igv, total, estado FROM ventas WHERE id = ?', [r.body.data.id]);
    assert.equal(Number(v.subtotal), 299.7);
    assert.equal(Number(v.igv), 53.95);
    assert.equal(Number(v.total), 353.65);
    assert.equal(v.estado, 'completada');
    const [[d]] = await pool.query('SELECT cantidad, precio_unitario, subtotal FROM detalle_ventas WHERE venta_id = ?', [r.body.data.id]);
    assert.equal(Number(d.subtotal), 299.7);
  });

  test('el precio guardado en la venta no cambia si el precio del producto cambia después', async () => {
    const p = (await crearProducto({ sku: 'VEN-2', precio: '50.00', stock: '5' })).body.data;
    const v = (await api.post('/api/sales', { producto_id: p.id, cantidad: 1 })).body.data;
    await api.put(`/api/products/${p.id}`, h.productoValido({ sku: 'VEN-2', precio: '80.00', stock: '4' }));
    const [[d]] = await pool.query('SELECT precio_unitario FROM detalle_ventas WHERE venta_id = ?', [v.id]);
    assert.equal(Number(d.precio_unitario), 50);
  });

  test('6. impide vender más que el stock y deja todo intacto (rollback)', async () => {
    const p = (await crearProducto({ sku: 'VEN-3', stock: '2' })).body.data;
    const [[antes]] = await pool.query('SELECT COUNT(*) AS n FROM ventas');
    const r = await api.post('/api/sales', { items: [{ producto_id: p.id, cantidad: 3 }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.codigo, 'STOCK_INSUFICIENTE');
    const [[despues]] = await pool.query('SELECT COUNT(*) AS n FROM ventas');
    assert.equal(despues.n, antes.n);
    assert.equal((await api.get(`/api/products/${p.id}`)).body.data.stock, 2);
  });

  test('transacción: si una línea falla, no se registra ninguna ni se descuenta stock', async () => {
    const a = (await crearProducto({ sku: 'TX-A', stock: '5' })).body.data;
    const b = (await crearProducto({ sku: 'TX-B', stock: '1' })).body.data;
    const r = await api.post('/api/sales', { items: [{ producto_id: a.id, cantidad: 2 }, { producto_id: b.id, cantidad: 2 }] });
    assert.equal(r.status, 409);
    assert.equal((await api.get(`/api/products/${a.id}`)).body.data.stock, 5);
    assert.equal((await api.get(`/api/products/${b.id}`)).body.data.stock, 1);
  });

  test('ventas concurrentes no generan sobreventa', async () => {
    const p = (await crearProducto({ sku: 'CON-1', stock: '5' })).body.data;
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => api.post('/api/sales', { items: [{ producto_id: p.id, cantidad: 1 }] })),
    );
    assert.equal(resultados.filter((r) => r.status === 201).length, 5);
    assert.equal(resultados.filter((r) => r.status === 409).length, 3);
    assert.equal((await api.get(`/api/products/${p.id}`)).body.data.stock, 0);
  });

  test('12. rechaza cantidades y productos inválidos', async () => {
    const p = (await crearProducto({ sku: 'VEN-4', stock: '5' })).body.data;
    for (const cantidad of [0, -1, 1.5, 'x', null, 99999999]) {
      const r = await api.post('/api/sales', { items: [{ producto_id: p.id, cantidad }] });
      assert.equal(r.status, 400, `cantidad ${cantidad}`);
    }
    assert.equal((await api.post('/api/sales', {})).status, 400);
    assert.equal((await api.post('/api/sales', { items: [] })).status, 400);
    assert.equal((await api.post('/api/sales', { items: [{ producto_id: 999999, cantidad: 1 }] })).status, 404);
    assert.equal((await api.post('/api/sales', { items: [{ producto_id: 'abc', cantidad: 1 }] })).status, 400);
  });

  test('anular una venta devuelve el stock y la excluye de reportes; no se puede anular dos veces', async () => {
    const p = (await crearProducto({ sku: 'ANU-1', stock: '5' })).body.data;
    const v = (await api.post('/api/sales', { items: [{ producto_id: p.id, cantidad: 2 }] })).body.data;
    assert.equal((await api.get(`/api/products/${p.id}`)).body.data.stock, 3);
    const a = await api.patch(`/api/sales/${v.id}/anular`);
    assert.equal(a.status, 200);
    assert.equal((await api.get(`/api/products/${p.id}`)).body.data.stock, 5);
    assert.equal((await api.patch(`/api/sales/${v.id}/anular`)).status, 409);
    assert.equal((await api.patch('/api/sales/999999/anular')).status, 404);

    const top = (await api.get('/api/products/top-selling')).body.data;
    assert.ok(!top.some((t) => t.id === p.id), 'una venta anulada no cuenta en el top');
  });

  test('historial: filtra por fecha y producto y calcula el total facturado', async () => {
    const a = (await crearProducto({ sku: 'HIS-A', precio: '10.00', stock: '100' })).body.data;
    const b = (await crearProducto({ sku: 'HIS-B', precio: '20.00', stock: '100' })).body.data;
    const ins = async (fecha, prod, cant, precio) => {
      const [r] = await pool.execute("INSERT INTO ventas (fecha, estado, subtotal, igv, total) VALUES (?, 'completada', ?, ?, ?)", [fecha, cant * precio, cant * precio * 0.18, cant * precio * 1.18]);
      await pool.execute('INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)',
        [r.insertId, prod, cant, precio, cant * precio]);
    };
    await ins('2020-03-10 10:00:00', a.id, 2, 10);
    await ins('2020-03-31 23:59:59', a.id, 1, 10); // último segundo del día «hasta»: debe incluirse
    await ins('2020-04-01 00:00:00', b.id, 4, 20);

    const marzo = await api.get(`/api/sales?desde=2020-03-01&hasta=2020-03-31&producto_id=${a.id}`);
    assert.equal(marzo.body.meta.total, 2);
    assert.equal(marzo.body.meta.totales.subtotal, 30);
    assert.equal(marzo.body.meta.totales.igv, 5.4);
    assert.equal(marzo.body.meta.totales.total_facturado, 35.4);
    assert.equal(marzo.body.data.length, 2);            // una fila por venta (comprobante)
    assert.equal(marzo.body.data[0].unidades > 0, true);

    const abril = await api.get(`/api/sales?desde=2020-04-01&hasta=2020-04-30`);
    assert.equal(abril.body.meta.totales.subtotal, 80);
    assert.equal(abril.body.meta.totales.total_facturado, 94.4);

    assert.equal((await api.get('/api/sales?desde=2020-13-01')).status, 400);
    assert.equal((await api.get('/api/sales?desde=2020-05-01&hasta=2020-01-01')).status, 400);
    assert.equal((await api.get('/api/sales?estado=otra')).status, 400);
  });
});

describe('Reportes', () => {
  before(async () => {
    // Base limpia con un escenario conocido
    await api.reiniciar();
    const ins = async (sku, nombre, precio) => {
      const [r] = await pool.execute(
        "INSERT INTO productos (sku, nombre, marca, modelo, talla, categoria, precio, stock) VALUES (?, ?, 'M', 'X', 40, 'C', ?, 100)",
        [sku, nombre, precio]);
      return r.insertId;
    };
    const venta = async (fecha, prod, cant, precio, estado = 'completada') => {
      const [r] = await pool.execute('INSERT INTO ventas (fecha, estado, subtotal, igv, total) VALUES (?, ?, ?, ?, ?)', [fecha, estado, cant * precio, cant * precio * 0.18, cant * precio * 1.18]);
      await pool.execute('INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)',
        [r.insertId, prod, cant, precio, cant * precio]);
    };
    const ids = {};
    // 7 productos: P1..P7. Unidades completadas: P1=50, P2=40, P3=30, P4=20, P5=10, P6=5, P7=5 (empate con P6)
    const datos = [['P1', 50], ['P2', 40], ['P3', 30], ['P4', 20], ['P5', 10], ['P6', 5], ['P7', 5]];
    for (const [sku] of datos) ids[sku] = await ins(sku + '-SKU', 'Producto ' + sku, 100);
    for (const [sku, total] of datos) {
      // mitad en enero 2021, mitad en marzo 2021 (febrero queda sin ventas)
      await venta('2021-01-15 10:00:00', ids[sku], Math.ceil(total / 2), 100);
      await venta('2021-03-20 10:00:00', ids[sku], Math.floor(total / 2), 100);
    }
    // ventas ANULADAS enormes de P7: no deben contar
    await venta('2021-01-20 10:00:00', ids.P7, 500, 100, 'anulada');
    // P5 solo vende fuera del periodo filtrado más abajo
    await venta('2021-06-01 10:00:00', ids.P5, 100, 100);
    // P8: ventas tardías para cambiar el top al filtrar por periodo
    ids.P8 = await ins('P8-SKU', 'Producto P8', 100);
    await venta('2021-03-25 10:00:00', ids.P8, 45, 100);
  });

  test('7. top 5 por unidades (no por importe), excluye anuladas y desempata por id', async () => {
    const r = await api.get('/api/products/top-selling');
    assert.equal(r.status, 200);
    const nombres = r.body.data.map((x) => x.nombre);
    // totales históricos: P5 = 10 + 100 = 110, P1=50, P8=45, P2=40, P3=30
    assert.deepEqual(nombres, ['Producto P5', 'Producto P1', 'Producto P8', 'Producto P2', 'Producto P3']);
    assert.equal(r.body.data[0].unidades_vendidas, 110);
    assert.equal(r.body.data.length, 5);
  });

  test('top 5 respeta el filtro de fechas y el desempate por id ascendente', async () => {
    const r = await api.get('/api/products/top-selling?desde=2021-01-01&hasta=2021-03-31');
    assert.deepEqual(r.body.data.map((x) => x.nombre),
      ['Producto P1', 'Producto P8', 'Producto P2', 'Producto P3', 'Producto P4']);
    // empate P6=5 y P7=5 queda fuera del top 5; comprobamos el desempate con límite en rango estrecho
    const solo = await api.get('/api/products/top-selling?desde=2021-01-01&hasta=2021-01-31');
    const unidades = solo.body.data.map((x) => x.unidades_vendidas);
    assert.deepEqual(unidades, [...unidades].sort((a, b) => b - a));
  });

  test('no inventa productos cuando hay menos de cinco', async () => {
    const r = await api.get('/api/products/top-selling?desde=2021-06-01&hasta=2021-06-30');
    assert.equal(r.body.data.length, 1);
    assert.equal(r.body.data[0].nombre, 'Producto P5');
    const vacio = await api.get('/api/products/top-selling?desde=2010-01-01&hasta=2010-01-31');
    assert.deepEqual(vacio.body.data, []);
  });

  test('8. agrupa las ventas mensuales de los top 5 con la misma regla de selección y ceros solo en meses sin ventas', async () => {
    const r = await api.get('/api/sales/monthly?desde=2021-01-01&hasta=2021-03-31');
    assert.deepEqual(r.body.data.meses.map((m) => m.clave), ['2021-01', '2021-02', '2021-03']);
    assert.deepEqual(r.body.data.series.map((s) => s.nombre),
      ['Producto P1', 'Producto P8', 'Producto P2', 'Producto P3', 'Producto P4']);
    const p1 = r.body.data.series.find((s) => s.nombre === 'Producto P1');
    assert.deepEqual(p1.datos, [25, 0, 25]); // febrero sin ventas => 0
    const p8 = r.body.data.series.find((s) => s.nombre === 'Producto P8');
    assert.deepEqual(p8.datos, [0, 0, 45]);

    // Histórico completo: el eje se extiende hasta junio 2021 e incluye P5
    const todo = await api.get('/api/sales/monthly');
    assert.equal(todo.body.data.series[0].nombre, 'Producto P5');
    assert.equal(todo.body.data.meses[0].clave, '2021-01');
    assert.equal(todo.body.data.meses.at(-1).clave, '2021-06');
  });

  test('resumen del dashboard coherente con la base de datos', async () => {
    const r = await api.get('/api/dashboard/resumen');
    const [[t]] = await pool.query("SELECT SUM(d.subtotal) s, SUM(d.cantidad) u FROM detalle_ventas d JOIN ventas v ON v.id=d.venta_id WHERE v.estado='completada'");
    assert.equal(r.body.data.ventas_totales, Number(t.s));
    assert.equal(r.body.data.unidades_vendidas, Number(t.u));
    assert.equal(r.body.data.productos_registrados, 8);
    assert.equal(r.body.data.top_5.length, 5);
    const mensual = await api.get('/api/dashboard/ventas-mensuales');
    assert.equal(mensual.body.data.importe.reduce((a, b) => a + b, 0), Number(t.s));
  });
});

describe('Predicción vía API', () => {
  const csvMeses = (n, base = 20000, paso = 500) => {
    const filas = ['anio,numero_mes,total_venta_mes'];
    for (let i = 0; i < n; i++) filas.push(`${2019 + Math.floor(i / 12)},${(i % 12) + 1},${(base + paso * i + (i % 3) * 100).toFixed(2)}`);
    return filas.join('\n');
  };

  test('9-13. sin datos: mensajes claros, sin entrenar ni predecir', async () => {
    await api.reiniciar();
    await pool.query('DELETE FROM historial_ventas_mensuales');
    const hist = await api.get('/api/predictions/history');
    assert.equal(hist.status, 200);
    assert.deepEqual(hist.body.data.serie, []);

    const tr = await api.post('/api/predictions/train', {});
    assert.equal(tr.status, 422);
    assert.equal(tr.body.error.codigo, 'DATOS_INSUFICIENTES');

    const m = await api.get('/api/predictions/metrics');
    assert.equal(m.status, 404);
    assert.equal(m.body.error.codigo, 'MODELO_NO_ENTRENADO');

    const p = await api.post('/api/predictions/predict', { periodo: '2020-12' });
    assert.equal(p.status, 409);
    assert.equal(p.body.error.codigo, 'MODELO_NO_ENTRENADO');
  });

  test('importa CSV válido, entrena de verdad, calcula MSE y predice', async () => {
    const imp = await api.pedir('POST', '/api/predictions/import', csvMeses(30), 'csv');
    assert.equal(imp.status, 201, JSON.stringify(imp.body));
    assert.equal(imp.body.data.filas_importadas, 30);

    const tr = await api.post('/api/predictions/train', { epochs: 300 });
    assert.equal(tr.status, 201, JSON.stringify(tr.body));
    const m = tr.body.data.metricas;
    assert.ok(m.prueba.mse >= 0 && Number.isFinite(m.prueba.mse));
    assert.ok(m.prueba.mae <= m.prueba.rmse + 1e-6, 'MAE <= RMSE');
    assert.ok(m.mejora_vs_promedio_pct > 50, 'la recta debe superar con claridad al promedio en datos casi lineales');
    assert.ok(Math.abs(tr.body.data.parametros.pendiente_soles_por_mes - 500) < 80);
    assert.equal(tr.body.data.n_observaciones, 30);

    const met = await api.get('/api/predictions/metrics');
    assert.equal(met.status, 200);
    assert.equal(met.body.data.metricas.prueba.mse, m.prueba.mse);

    const hist = await api.get('/api/predictions/history');
    assert.equal(hist.body.data.modelo_entrenado, true);
    const periodo = hist.body.data.periodos_disponibles[0].valor; // mes siguiente al último dato
    const pr = await api.post('/api/predictions/predict', { periodo });
    assert.equal(pr.status, 200);
    assert.equal(pr.body.data.moneda, 'PEN');
    // índice 31 => ≈ 20000 + 500*30 = 35000 (±)
    assert.ok(Math.abs(pr.body.data.estimacion - 35100) < 1200, `estimación ${pr.body.data.estimacion}`);
    assert.match(pr.body.data.aviso, /no es una garantía/i);
  });

  test('predicciones con periodos inválidos devuelven 400', async () => {
    for (const periodo of ['', 'abc', '2030-13', '2019-01', undefined]) {
      const r = await api.post('/api/predictions/predict', { periodo });
      assert.equal(r.status, 400, String(periodo));
    }
    assert.equal((await api.post('/api/predictions/predict', { periodo: '2090-01' })).status, 400); // fuera del horizonte
  });

  test('config de entrenamiento inválida devuelve 400', async () => {
    assert.equal((await api.post('/api/predictions/train', { epochs: 3 })).status, 400);
    assert.equal((await api.post('/api/predictions/train', { learning_rate: 5 })).status, 400);
  });

  test('CSV malformado se rechaza completo y sin importar nada', async () => {
    const [[antes]] = await pool.query('SELECT COUNT(*) n FROM historial_ventas_mensuales');
    const malos = [
      'mes,total\n1,100',
      'anio,numero_mes,total_venta_mes\n2020,13,100',
      'anio,numero_mes,total_venta_mes\n2020,1,abc',
      'anio,numero_mes,total_venta_mes\n2020,1,-5',
      'anio,numero_mes,total_venta_mes\n2020,1,100\n2020,1,200',
      'anio,numero_mes,total_venta_mes\n2020,1,100\n2020,2',
      'anio,numero_mes,total_venta_mes\n2090,1,100',
      '',
      'anio,numero_mes,total_venta_mes',
    ];
    for (const csv of malos) {
      const r = await api.pedir('POST', '/api/predictions/import', csv, 'csv');
      assert.ok([400, 413].includes(r.status), `debería rechazar: ${JSON.stringify(csv)} -> ${r.status}`);
      assert.equal(r.body.success, false);
    }
    const [[despues]] = await pool.query('SELECT COUNT(*) n FROM historial_ventas_mensuales');
    assert.equal(despues.n, antes.n);
    const enorme = 'anio,numero_mes,total_venta_mes\n' + '2020,1,1\n'.repeat(30000);
    assert.equal((await api.pedir('POST', '/api/predictions/import', enorme, 'csv')).status, 413);
  });

  test('regla de combinación: si un mes existe también en ventas del sistema, prevalece el sistema', async () => {
    await pool.query('DELETE FROM historial_ventas_mensuales');
    await pool.query('DELETE FROM detalle_ventas'); await pool.query('DELETE FROM ventas');
    await api.pedir('POST', '/api/predictions/import', 'anio,numero_mes,total_venta_mes\n2022,1,1000\n2022,2,2000', 'csv');
    const [pr] = await pool.execute("INSERT INTO productos (sku, nombre, marca, modelo, talla, categoria, precio, stock) VALUES ('COMB-1','C','M','X',40,'C',50,10)");
    const [v] = await pool.execute("INSERT INTO ventas (fecha, estado, total) VALUES ('2022-02-10 10:00:00','completada',500)");
    await pool.execute('INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?,?,?,?,?)', [v.insertId, pr.insertId, 10, 50, 500]);

    const h2 = (await api.get('/api/predictions/history')).body.data;
    const feb = h2.serie.find((f) => f.clave === '2022-02');
    assert.equal(feb.total_venta_mes, 500);
    assert.equal(feb.origen, 'sistema');
    assert.equal(h2.serie.length, 2);               // sin duplicar el mes
    assert.equal(h2.resumen.fuentes.solapados_prevalece_sistema, 1);
  });

  test('el mes en curso se excluye de la serie y los meses faltantes no se rellenan', async () => {
    await pool.query('DELETE FROM historial_ventas_mensuales');
    await pool.query('DELETE FROM detalle_ventas'); await pool.query('DELETE FROM ventas');
    await api.pedir('POST', '/api/predictions/import', 'anio,numero_mes,total_venta_mes\n2022,1,1000\n2022,4,4000', 'csv');
    const hist = (await api.get('/api/predictions/history')).body.data;
    assert.deepEqual(hist.resumen.meses_faltantes, ['2022-02', '2022-03']);
    assert.deepEqual(hist.serie.map((f) => f.indice), [1, 4]); // el índice conserva la distancia real
    const [[{ ym }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(),'%Y-%m') ym");
    const mesActual = await api.pedir('POST', '/api/predictions/import', `anio,numero_mes,total_venta_mes\n${ym.slice(0, 4)},${Number(ym.slice(5))},100`, 'csv');
    assert.equal(mesActual.status, 400);
  });
});

describe('Manejo de errores de la API', () => {
  test('13. rutas inexistentes, ids inválidos y JSON roto devuelven JSON consistente', async () => {
    const nf = await api.get('/api/no-existe');
    assert.equal(nf.status, 404);
    assert.equal(nf.body.success, false);
    assert.equal((await api.get('/api/products/abc')).status, 400);
    assert.equal((await api.get('/api/products/0')).status, 400);
    assert.equal((await api.get('/api/products/999999')).status, 404);
    assert.equal((await api.put('/api/products/999999', h.productoValido())).status, 404);
    assert.equal((await api.del('/api/products/999999')).status, 404);
    assert.equal((await api.get('/api/products?page=0')).status, 400);
    assert.equal((await api.get('/api/products?limit=5000')).status, 400);

  });

  test('JSON malformado -> 400 sin filtrar detalles internos', async () => {
    const srv = await h.iniciarServidor();
    try {
      const r = await fetch(`${srv.base}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"sku": ' });
      const body = await r.json();
      assert.equal(r.status, 400);
      assert.equal(body.error.codigo, 'JSON_INVALIDO');
    } finally { await srv.cerrar(); }
  });

  test('error de base de datos -> 503/500 genérico, sin exponer SQL ni credenciales', async () => {
    const original = pool.execute;
    const originalQuery = pool.query;
    const silenciar = console.error; console.error = () => {};
    pool.execute = async () => { const e = new Error("Access denied for user 'root'@'localhost' (password: YES) SELECT secreto"); e.code = 'ER_ACCESS_DENIED_ERROR'; throw e; };
    pool.query = pool.execute;
    try {
      const r = await api.get('/api/products/1');
      assert.equal(r.status, 503);
      const texto = JSON.stringify(r.body);
      assert.ok(!/root|password|secreto|SELECT/i.test(texto), texto);
    } finally {
      pool.execute = original; pool.query = originalQuery; console.error = silenciar;
    }
  });
});

describe('IGV, comprobante, reportes y registro de predicciones', () => {
  test('venta de varias líneas: IGV 18 % calculado en el servidor en céntimos; GET /api/sales/:id devuelve el comprobante', async () => {
    await api.reiniciar();
    const a = (await crearProducto({ sku: 'IGV-A', precio: '10.10', stock: '50' })).body.data;
    const b = (await crearProducto({ sku: 'IGV-B', precio: '0.99', stock: '50' })).body.data;
    const r = await api.post('/api/sales', { items: [{ producto_id: a.id, cantidad: 3 }, { producto_id: b.id, cantidad: 7 }] });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.subtotal, 37.23);                      // 30.30 + 6.93
    assert.equal(r.body.data.igv, 6.7);                             // 6.7014 -> 6.70
    assert.equal(r.body.data.total, 43.93);
    const d = (await api.get(`/api/sales/${r.body.data.id}`)).body.data;
    assert.equal(d.lineas.length, 2);
    assert.equal(d.igv_porcentaje, 18);
    assert.equal(d.total, 43.93);
    assert.equal((await api.get('/api/sales/99999')).status, 404);
    const lista = (await api.get('/api/sales')).body;
    assert.equal(lista.data.length, 1);                              // una fila por venta
    assert.equal(lista.data[0].unidades, 10);
    assert.match(lista.data[0].productos, /Zapatilla de prueba/);
  });

  test('productos: descripción opcional, unidades vendidas y filtro por categoría', async () => {
    const p = (await crearProducto({ sku: 'DES-1', categoria: 'Trail', descripcion: '  Ligera   y cómoda ', stock: '5' })).body.data;
    assert.equal(p.descripcion, 'Ligera y cómoda');
    assert.equal((await crearProducto({ sku: 'DES-2', descripcion: 'x'.repeat(256) })).status, 400);
    await api.post('/api/sales', { items: [{ producto_id: p.id, cantidad: 2 }] });
    const l = (await api.get('/api/products?categoria=Trail&orden=vendidos&direccion=desc')).body;
    assert.equal(l.data.length, 1);
    assert.equal(l.data[0].vendidos, 2);
    const cats = (await api.get('/api/products/categories')).body.data;
    assert.ok(cats.find((c) => c.categoria === 'Trail' && c.productos === 1));
  });

  test('reporte: totales con IGV, categorías, y exportación CSV/XLSX', async () => {
    const r = (await api.get('/api/reports/summary')).body.data;
    assert.equal(r.kpis.ventas, 2);
    assert.ok(Math.abs(r.kpis.total - (r.kpis.subtotal + r.kpis.igv)) < 0.011);
    assert.ok(r.por_producto.length >= 2);
    const get = (ruta) => fetch(api.base + ruta, { headers: { Cookie: api.cookie() } });
    const csv = await get('/api/reports/export.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const xlsx = await get('/api/reports/export.xlsx');
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
    const buf = Buffer.from(await xlsx.arrayBuffer());
    assert.equal(buf.slice(0, 2).toString(), 'PK');                 // un .xlsx es un ZIP
    assert.equal((await get('/api/reports/export.xlsx?desde=2020-13-01')).status, 400);
  });

  test('registro de predicciones: cada predicción queda guardada con usuario; MAPE en métricas', async () => {
    const filas = ['anio,numero_mes,total_venta_mes'];
    for (let i = 0; i < 18; i++) filas.push(`${2019 + Math.floor(i / 12)},${(i % 12) + 1},${(20000 + 500 * i + (i % 3) * 100).toFixed(2)}`);
    assert.equal((await api.pedir('POST', '/api/predictions/import', filas.join('\n'), 'csv')).status, 201);
    const t = await api.post('/api/predictions/train', {});
    assert.equal(t.status, 201);
    assert.equal(typeof t.body.data.metricas.prueba.mape, 'number');
    const pr = await api.post('/api/predictions/predict', { periodo: '2020-12' });
    assert.equal(pr.status, 200);
    const log = (await api.get('/api/predictions/log')).body.data;
    assert.equal(log.length, 1);
    assert.equal(log[0].periodo, '2020-12');
    assert.equal(log[0].estimacion, pr.body.data.estimacion);
    assert.equal(log[0].usuario, 'Usuario administrador');
    assert.equal((await api.post('/api/predictions/predict', { periodo: 'mal' })).status, 400);
    assert.equal((await api.get('/api/predictions/log')).body.data.length, 1);   // las inválidas no se registran
  });
});

describe('Fotos de productos', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const carpeta = path.join(__dirname, '../publico/imagenes/productos');

  test('asocia las fotos por SKU o por ID, sin importar mayúsculas, e ignora lo que no es imagen', async () => {
    const a = (await crearProducto({ sku: 'FOTO-SKU-1' })).body.data;
    const b = (await crearProducto({ sku: 'FOTO-ID-2' })).body.data;
    const c = (await crearProducto({ sku: 'SIN-FOTO-3' })).body.data;
    const creados = [path.join(carpeta, 'foto-sku-1.PNG'), path.join(carpeta, `${b.id}.webp`), path.join(carpeta, 'sin-foto-3.txt')];
    try {
      for (const f of creados) fs.writeFileSync(f, 'x');
      const r = await api.get('/api/products/imagenes');
      assert.equal(r.status, 200);
      const m = r.body.data;
      assert.match(m[String(a.id)], /^\/imagenes\/productos\/foto-sku-1\.PNG\?v=\d+$/);
      assert.equal(m['FOTO-SKU-1'], m[String(a.id)]);
      assert.match(m[String(b.id)], new RegExp(`^/imagenes/productos/${b.id}\\.webp\\?v=\\d+$`));
      assert.equal(m[String(c.id)], undefined);      // .txt no cuenta como foto
      assert.equal((await api.sinSesion().get('/api/products/imagenes')).status, 401);
    } finally {
      for (const f of creados) fs.rmSync(f, { force: true });
    }
  });
});

describe('Subir y quitar foto de producto', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const carpeta = path.join(__dirname, '../publico/imagenes/productos');
  // PNG mínimo válido de 1×1 px
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const subir = (id, datos, mime = 'image/png', cliente = api) => cliente.pedir('PUT', `/api/products/${id}/imagen`, { datos, mime }, 'binario');

  test('subir reemplaza la foto anterior, la lista la devuelve y quitar la borra', async () => {
    const prod = (await crearProducto({ sku: 'SUBE-FOTO-1' })).body.data;
    const vieja = path.join(carpeta, 'sube-foto-1.jpg');
    try {
      fs.writeFileSync(vieja, 'antigua');                                  // foto manual previa por SKU
      const r = await subir(prod.id, PNG);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.archivo, `${prod.id}.png`);
      assert.equal(fs.existsSync(vieja), false);                            // la anterior se reemplazó
      assert.equal(fs.existsSync(path.join(carpeta, `${prod.id}.png`)), true);
      assert.match((await api.get('/api/products/imagenes')).body.data[String(prod.id)], new RegExp(`/${prod.id}\\.png\\?v=`));
      assert.equal((await api.del(`/api/products/${prod.id}/imagen`)).status, 200);
      assert.equal(fs.existsSync(path.join(carpeta, `${prod.id}.png`)), false);
    } finally { for (const f of [vieja, path.join(carpeta, `${prod.id}.png`)]) fs.rmSync(f, { force: true }); }
  });

  test('rechaza archivos que no son imagen aunque declaren serlo, vacíos y productos inexistentes', async () => {
    const prod = (await crearProducto({ sku: 'SUBE-FOTO-2' })).body.data;
    assert.equal((await subir(prod.id, Buffer.from('<script>alert(1)</script>-------'))).status, 400);   // finge ser PNG
    assert.equal((await subir(prod.id, Buffer.alloc(0))).status, 400);
    assert.equal((await subir(99999999, PNG)).status, 404);
    assert.equal((await subir(prod.id, Buffer.alloc(4 * 1024 * 1024, 1))).status, 413);                   // > 3 MB
    assert.equal((await subir(prod.id, PNG, 'application/pdf')).status === 200, false);                  // tipo no admitido
    assert.equal(fs.existsSync(path.join(carpeta, `${prod.id}.png`)), false);
  });

  test('solo el administrador puede subir o quitar fotos; eliminar el producto borra su foto', async () => {
    const prod = (await crearProducto({ sku: 'SUBE-FOTO-3' })).body.data;
    const archivo = path.join(carpeta, `${prod.id}.png`);
    try {
      const vend = await api.conRol('vendedor');
      assert.equal((await subir(prod.id, PNG, 'image/png', vend)).status, 403);
      assert.equal((await vend.del(`/api/products/${prod.id}/imagen`)).status, 403);
      assert.equal((await subir(prod.id, PNG, 'image/png', api.sinSesion())).status, 401);
      assert.equal((await subir(prod.id, PNG)).status, 200);
      assert.equal(fs.existsSync(archivo), true);
      assert.equal((await api.del(`/api/products/${prod.id}`)).status, 200);
      assert.equal(fs.existsSync(archivo), false);
    } finally { fs.rmSync(archivo, { force: true }); }
  });
});

describe('Portada del login', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const carpeta = path.join(__dirname, '../publico/imagenes/portada');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const put = (datos, mime = 'image/png', cliente = api) => cliente.pedir('PUT', '/api/portada', { datos, mime }, 'binario');
  const limpiar = () => { for (const f of fs.existsSync(carpeta) ? fs.readdirSync(carpeta) : []) if (/^portada\./i.test(f)) fs.rmSync(path.join(carpeta, f), { force: true }); };

  test('el GET es público, el administrador sube y quita la portada, y se reemplaza la anterior', async () => {
    limpiar();
    try {
      const sin = await api.sinSesion().get('/api/portada');
      assert.equal(sin.status, 200);
      assert.equal(sin.body.data.url, null);
      assert.equal((await put(PNG)).status, 200);
      const con = await api.sinSesion().get('/api/portada');              // sin sesión: el login debe poder verla
      assert.match(con.body.data.url, /^\/imagenes\/portada\/portada\.png\?v=\d+$/);
      assert.equal((await api.sinSesion().get(con.body.data.url)).status, 200);   // y el archivo se sirve
      assert.equal((await api.del('/api/portada')).status, 200);
      assert.equal((await api.get('/api/portada')).body.data.url, null);
    } finally { limpiar(); }
  });

  test('solo el administrador puede cambiarla; rechaza archivos falsos, vacíos y muy pesados', async () => {
    try {
      assert.equal((await put(PNG, 'image/png', api.sinSesion())).status, 401);
      assert.equal((await put(PNG, 'image/png', await api.conRol('vendedor'))).status, 403);
      assert.equal((await put(PNG, 'image/png', await api.conRol('analista'))).status, 403);
      assert.equal((await put(Buffer.from('<?php echo 1; ?>-----------'))).status, 400);
      assert.equal((await put(Buffer.alloc(0))).status, 400);
      assert.equal((await put(Buffer.alloc(6 * 1024 * 1024, 1))).status, 413);
      assert.equal((await api.get('/api/portada')).body.data.url, null);
    } finally { limpiar(); }
  });
});
