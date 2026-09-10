import { query, pool } from '../src/config/database.js'
import 'dotenv/config'

async function initSueldos() {
  const client = await pool.connect()
  try {
    console.log('🔧 Inicializando sistema de sueldos...')

    // 1. Crear tabla sueldos_pagados
    await client.query(`
      CREATE TABLE IF NOT EXISTS sueldos_pagados (
        id_sueldo SERIAL PRIMARY KEY,
        id_profesor INTEGER NOT NULL,
        mes CHAR(7) NOT NULL,
        monto NUMERIC(12, 2) NOT NULL,
        medio_pago VARCHAR(50),
        numero_comprobante VARCHAR(100),
        observaciones TEXT,
        fecha_pago DATE NOT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT fk_profesor FOREIGN KEY (id_profesor)
          REFERENCES profesores(id_profesor) ON DELETE RESTRICT,
        CONSTRAINT unique_profesor_mes UNIQUE(id_profesor, mes)
      )
    `)
    console.log('✅ Tabla sueldos_pagados creada/verificada')

    // 2. Crear índices
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sueldos_mes ON sueldos_pagados(mes)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sueldos_profesor ON sueldos_pagados(id_profesor)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sueldos_fecha ON sueldos_pagados(fecha_pago DESC)`)
    console.log('✅ Índices creados/verificados')

    // 3. Agregar columna porcentaje_p a profesores
    const { rows: columnExists } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'profesores' AND column_name = 'porcentaje_p'
    `)

    if (columnExists.length === 0) {
      await client.query(`ALTER TABLE profesores ADD COLUMN porcentaje_p NUMERIC(5, 2) DEFAULT 0`)
      console.log('✅ Columna porcentaje_p agregada a profesores')
    } else {
      console.log('ℹ️  Columna porcentaje_p ya existe en profesores')
    }

    // 4. Verificar/crear categoría Sueldo
    const { rows: categorias } = await client.query(`
      SELECT id_categoria FROM categorias_movimiento WHERE nombre_cm = 'Sueldo'
    `)

    if (categorias.length === 0) {
      await client.query(`
        INSERT INTO categorias_movimiento (nombre_cm, tipo_cm, activo_cm)
        VALUES ('Sueldo', 'Egreso', true)
      `)
      console.log('✅ Categoría "Sueldo" creada en movimientos')
    } else {
      console.log('ℹ️  Categoría "Sueldo" ya existe')
    }

    // 5. Crear trigger para actualizar timestamp
    await client.query(`
      CREATE OR REPLACE FUNCTION update_sueldos_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.actualizado_en = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)

    await client.query(`
      DROP TRIGGER IF EXISTS update_sueldos_timestamp_trigger ON sueldos_pagados
    `)

    await client.query(`
      CREATE TRIGGER update_sueldos_timestamp_trigger
      BEFORE UPDATE ON sueldos_pagados
      FOR EACH ROW
      EXECUTE FUNCTION update_sueldos_timestamp()
    `)
    console.log('✅ Trigger de actualización creado')

    console.log('\n✨ Sistema de sueldos inicializado correctamente\n')
  } catch (err) {
    console.error('❌ Error al inicializar sueldos:', err.message)
    throw err
  } finally {
    client.release()
  }
}

// Ejecutar si se llama como script principal
if (process.argv[1] === new URL(import.meta.url).pathname) {
  initSueldos()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

export default initSueldos
