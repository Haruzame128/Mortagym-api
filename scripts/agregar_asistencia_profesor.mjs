// Asistencia del profesor para el cálculo "por_hora" de Sueldos — la tabla
// vieja "asistencia" (entrada/salida genérica, sin relación a horarios) no
// servía para esto y no tiene ninguna ruta que la use; se deja tal cual, sin
// tocar.
//
// Diseño: "la ausencia es la excepción". Por defecto (sin fila acá) se
// asume que el profesor SÍ dio la clase — solo se carga una fila cuando se
// marca que faltó. Eso mantiene la tabla chica y no exige confirmar cada
// clase de la historia para que el cálculo siga funcionando como antes.
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
    CREATE TABLE IF NOT EXISTS asistencia_profesor (
      id_horario  BIGINT NOT NULL REFERENCES horarios(id_horario) ON DELETE CASCADE,
      id_profesor BIGINT NOT NULL REFERENCES profesores(id_profesor) ON DELETE CASCADE,
      fecha       DATE NOT NULL,
      asistio     BOOLEAN NOT NULL DEFAULT false,
      observacion TEXT,
      actualizado_en TIMESTAMP DEFAULT now(),
      PRIMARY KEY (id_horario, id_profesor, fecha)
    )
  `)
  console.log('Tabla asistencia_profesor creada')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
