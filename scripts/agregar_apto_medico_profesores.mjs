// Mismo "Apto médico" que ya existe para clientes (certificado físico
// entregado en persona, vence al año de la entrega), ahora para profesores.
// clientes ya tenía venc_ficha_medica de antes; profesores no tiene ningún
// campo parecido, así que acá se agregan las dos columnas de una.
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
    ALTER TABLE profesores
      ADD COLUMN IF NOT EXISTS fecha_entrega_ficha_medica DATE,
      ADD COLUMN IF NOT EXISTS venc_ficha_medica DATE
  `)
  console.log('Columnas de apto médico agregadas a profesores')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
