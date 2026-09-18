// Los ejercicios ya usados en rutinas de un alumno no se pueden borrar sin
// perder ese historial (rutinas.id_ejercicio es RESTRICT). En vez de eso, al
// "eliminar" un ejercicio en uso se lo desactiva: desaparece del selector
// del profesor para rutinas nuevas, pero las rutinas ya cargadas lo siguen
// mostrando tal cual.
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
  await pool.query(`ALTER TABLE ejercicios ADD COLUMN IF NOT EXISTS activo_e BOOLEAN NOT NULL DEFAULT true`)
  console.log('Listo: ejercicios.activo_e')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
