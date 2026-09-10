// Dos cambios al módulo de Sueldos, pedidos juntos:
//
// 1) Sueldos pasa de calcularse por "mes calendario" a un rango de fechas
//    desde/hasta elegido a mano. Esto permite prorratear el primer/último
//    período de un profesor que entra o sale a mitad de mes, en vez de
//    cobrarle siempre el mes completo. Se agregan fecha_desde/fecha_hasta a
//    sueldos_pagados; mes se deja NULL para pagos nuevos (se mantiene en las
//    52 filas históricas ya cargadas, por compatibilidad de lectura).
//
// 2) horario_profesores: tabla nueva para que un horario pueda tener
//    profesores adicionales además del titular (horarios.id_profesor) — para
//    disciplinas donde dan la misma clase juntos (ej. Natación). Cada
//    co-profesor cobra su sueldo completo por ese horario, de forma
//    independiente (no se reparte).
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
})

async function main() {
  await pool.query(`
    ALTER TABLE sueldos_pagados
      ADD COLUMN IF NOT EXISTS fecha_desde DATE,
      ADD COLUMN IF NOT EXISTS fecha_hasta DATE,
      ALTER COLUMN mes DROP NOT NULL
  `)

  // Backfill de las filas históricas: fecha_desde/hasta = primer y último día
  // del mes que ya tenían cargado, para que el historial siga mostrando un
  // rango coherente aunque se haya pagado bajo el esquema viejo.
  await pool.query(`
    UPDATE sueldos_pagados
    SET fecha_desde = (mes || '-01')::date,
        fecha_hasta = ((mes || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date
    WHERE fecha_desde IS NULL AND mes IS NOT NULL
  `)

  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_profesor_rango'
      ) THEN
        ALTER TABLE sueldos_pagados
          ADD CONSTRAINT unique_profesor_rango UNIQUE (id_profesor, fecha_desde, fecha_hasta);
      END IF;
    END $$;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS horario_profesores (
      id_horario  BIGINT NOT NULL REFERENCES horarios(id_horario) ON DELETE CASCADE,
      id_profesor BIGINT NOT NULL REFERENCES profesores(id_profesor) ON DELETE CASCADE,
      creado_en   TIMESTAMP DEFAULT now(),
      PRIMARY KEY (id_horario, id_profesor)
    )
  `)

  console.log('Migración de sueldos (rango de fechas) y horario_profesores aplicada')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
