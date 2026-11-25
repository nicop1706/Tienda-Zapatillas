-- =====================================================================
-- Sistema Web de Predicción y Reporte de Ventas de una Tienda de Zapatillas
-- Esquema MySQL 8.x (compatible con MariaDB 10.4+)
--
-- Uso:  mysql -u root -p < base_de_datos/esquema.sql      (o:  npm run db:setup)
-- El script es idempotente: puede ejecutarse varias veces sin borrar datos.
-- Las columnas añadidas en versiones posteriores se migran en herramientas/configurar-bd.js.
-- =====================================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS tienda_zapatillas
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tienda_zapatillas;

-- ---------------------------------------------------------------------
-- Catálogo de productos y stock
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sku         VARCHAR(40)   NOT NULL,
  nombre      VARCHAR(120)  NOT NULL,
  marca       VARCHAR(60)   NOT NULL,
  modelo      VARCHAR(60)   NOT NULL,
  talla       DECIMAL(4,1)  NOT NULL,
  categoria   VARCHAR(60)   NOT NULL,
  descripcion VARCHAR(255)  NULL,
  precio      DECIMAL(10,2) NOT NULL,          -- precio de venta SIN IGV
  stock       INT UNSIGNED  NOT NULL DEFAULT 0,
  creado_en   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_productos_sku (sku),
  KEY idx_productos_nombre (nombre),
  KEY idx_productos_marca (marca),
  KEY idx_productos_categoria (categoria),
  CONSTRAINT chk_productos_precio CHECK (precio > 0),
  CONSTRAINT chk_productos_talla  CHECK (talla BETWEEN 20 AND 55)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Cabecera de ventas
--   subtotal = suma de líneas (sin IGV); igv = subtotal * tasa; total = subtotal + igv.
--   estado = 'anulada' excluye la venta de todos los reportes y del
--   entrenamiento del modelo; al anular se devuelve el stock.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ventas (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  fecha      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado     ENUM('completada','anulada') NOT NULL DEFAULT 'completada',
  subtotal   DECIMAL(12,2) NOT NULL DEFAULT 0,
  igv        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total      DECIMAL(12,2) NOT NULL DEFAULT 0,
  anulada_en DATETIME      NULL,
  PRIMARY KEY (id),
  KEY idx_ventas_fecha (fecha),
  KEY idx_ventas_estado_fecha (estado, fecha),
  CONSTRAINT chk_ventas_total    CHECK (total >= 0),
  CONSTRAINT chk_ventas_subtotal CHECK (subtotal >= 0),
  CONSTRAINT chk_ventas_igv      CHECK (igv >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Detalle de ventas: producto, cantidad y precio aplicado EN ESE MOMENTO
-- (el precio del catálogo puede cambiar después sin alterar el histórico)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detalle_ventas (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  venta_id        INT UNSIGNED  NOT NULL,
  producto_id     INT UNSIGNED  NOT NULL,
  cantidad        INT UNSIGNED  NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_detalle_venta (venta_id),
  KEY idx_detalle_producto (producto_id, venta_id),
  CONSTRAINT fk_detalle_venta
    FOREIGN KEY (venta_id) REFERENCES ventas (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_detalle_producto
    FOREIGN KEY (producto_id) REFERENCES productos (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_detalle_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_detalle_precio   CHECK (precio_unitario > 0),
  CONSTRAINT chk_detalle_subtotal CHECK (subtotal >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Historial mensual IMPORTADO (CSV): meses anteriores al uso del sistema.
--
-- Las ventas reales se agregan EN VIVO desde ventas/detalle_ventas
-- (consulta GROUP BY), por lo que nunca quedan agregados desactualizados.
-- Esta tabla solo guarda los totales mensuales que el usuario importa
-- desde un CSV validado. Regla de combinación: si un mes existe en ambas
-- fuentes, prevalece la venta real del sistema.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historial_ventas_mensuales (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  anio            SMALLINT UNSIGNED NOT NULL,
  mes             TINYINT UNSIGNED  NOT NULL,
  total_venta_mes DECIMAL(14,2) NOT NULL,
  origen          VARCHAR(20)   NOT NULL DEFAULT 'csv',
  actualizado_en  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_historial_anio_mes (anio, mes),
  CONSTRAINT chk_historial_mes   CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT chk_historial_anio  CHECK (anio BETWEEN 2000 AND 2100),
  CONSTRAINT chk_historial_total CHECK (total_venta_mes >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Usuarios del sistema. La contraseña NUNCA se guarda en claro: solo el
-- hash scrypt con sal aleatoria (formato scrypt$N$r$p$sal$hash).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol           ENUM('administrador','vendedor','analista') NOT NULL DEFAULT 'vendedor',
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acceso DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Sesiones activas. Solo se guarda el SHA-256 del token (el token real
-- viaja únicamente en una cookie HttpOnly); si se filtra la tabla, los
-- tokens no se pueden usar.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash CHAR(64)     NOT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  creada_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en  DATETIME     NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_sesiones_usuario (usuario_id),
  KEY idx_sesiones_expira (expira_en),
  CONSTRAINT fk_sesiones_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Registro de predicciones realizadas desde la interfaz (auditoría y
-- «Historial de predicciones»). Guarda lo que el modelo estimó en ese
-- momento y el MSE de prueba del modelo usado.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historial_predicciones (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  creado_en   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  periodo     CHAR(7)       NOT NULL,           -- AAAA-MM
  estimacion  DECIMAL(14,2) NOT NULL,
  mse         DECIMAL(18,2) NULL,
  usuario_id  INT UNSIGNED  NULL,
  PRIMARY KEY (id),
  KEY idx_hist_pred_fecha (creado_en),
  CONSTRAINT fk_hist_pred_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;
