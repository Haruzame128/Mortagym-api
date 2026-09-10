-- Script para setup del sistema de sueldos
-- Ejecutar en la base de datos de producción

-- 1. Crear tabla sueldos_pagados
CREATE TABLE IF NOT EXISTS sueldos_pagados (
  id_sueldo SERIAL PRIMARY KEY,
  id_profesor INTEGER NOT NULL,
  mes CHAR(7) NOT NULL, -- Formato: YYYY-MM
  monto NUMERIC(12, 2) NOT NULL,
  medio_pago VARCHAR(50),
  numero_comprobante VARCHAR(100),
  observaciones TEXT,
  fecha_pago DATE NOT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_profesor FOREIGN KEY (id_profesor) REFERENCES profesores(id_profesor) ON DELETE RESTRICT,
  CONSTRAINT unique_profesor_mes UNIQUE(id_profesor, mes)
);

-- 2. Crear índices para mejorar búsquedas
CREATE INDEX IF NOT EXISTS idx_sueldos_mes ON sueldos_pagados(mes);
CREATE INDEX IF NOT EXISTS idx_sueldos_profesor ON sueldos_pagados(id_profesor);
CREATE INDEX IF NOT EXISTS idx_sueldos_fecha ON sueldos_pagados(fecha_pago DESC);

-- 3. Agregar columna porcentaje_p a tabla profesores (si no existe)
ALTER TABLE profesores
ADD COLUMN IF NOT EXISTS porcentaje_p NUMERIC(5, 2) DEFAULT 0;

-- 4. Verificar que existe la categoría "Sueldo" en movimientos
INSERT INTO categorias_movimiento (nombre_cm, tipo_cm, activo_cm)
VALUES ('Sueldo', 'Egreso', true)
ON CONFLICT (nombre_cm) DO NOTHING;

-- 5. Crear trigger para actualizar campo actualizado_en
CREATE OR REPLACE FUNCTION update_sueldos_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_sueldos_timestamp_trigger ON sueldos_pagados;
CREATE TRIGGER update_sueldos_timestamp_trigger
BEFORE UPDATE ON sueldos_pagados
FOR EACH ROW
EXECUTE FUNCTION update_sueldos_timestamp();

-- 6. Verificar que la tabla se creó correctamente
SELECT tablename FROM pg_tables WHERE tablename = 'sueldos_pagados';
SELECT COUNT(*) as columnas FROM information_schema.columns WHERE table_name = 'sueldos_pagados';

-- 7. (OPCIONAL) Agregar algunos datos de prueba
-- INSERT INTO sueldos_pagados (id_profesor, mes, monto, medio_pago, fecha_pago)
-- VALUES (1, '2025-01', 7500.00, 'Transferencia', CURRENT_DATE)
-- ON CONFLICT DO NOTHING;
