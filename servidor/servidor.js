const { ping, close } = require('./configuracion/baseDatos');
const { crearApp } = require('./aplicacion');

const PORT = Number(process.env.PORT) || 3000;

async function iniciar() {
  try {
    await ping();
    console.log('[db] Conexión a MySQL correcta.');
  } catch (err) {
    console.error('[db] No se pudo conectar a MySQL:', err.code || err.message);
    console.error('     Revisa que MySQL esté activo, que la base exista y los datos del archivo .env.');
    process.exit(1);
  }

  try {
    const a = await require('./servicios/autenticacionServicio').asegurarAdministrador();
    if (a) {
      console.log(`[auth] Administrador inicial creado: ${a.email}`);
      if (a.generada) console.log(`[auth] Contraseña generada (cámbiala al entrar): ${a.password}`);
    }
  } catch (err) {
    console.error('[auth] No se pudo preparar el usuario administrador:', err.message);
    process.exit(1);
  }

  const app = crearApp();
  const servidor = app.listen(PORT, () => {
    console.log(`[http] Servidor listo en http://localhost:${PORT}`);
  });

  const apagar = async () => {
    console.log('\n[http] Cerrando...');
    servidor.close(async () => {
      await close();
      process.exit(0);
    });
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
}

iniciar();
