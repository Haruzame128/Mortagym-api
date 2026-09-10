// Agrega el flag disciplinas.usa_precio_profesor — antes, si una disciplina
// nueva (o con todos los precio_N_profesor en 0, como Natación tras revertir
// un valor de prueba) quería habilitar la modalidad "con profesor", el editor
// de precios no mostraba esa columna porque decidía mostrarla solo si ya
// había algún precio > 0 cargado: imposible cargar el primer valor.
// Este flag desacopla "quiero usar esta modalidad" de "ya tengo precios
// cargados en ella".
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
    ALTER TABLE disciplinas
    ADD COLUMN IF NOT EXISTS usa_precio_profesor BOOLEAN NOT NULL DEFAULT false
  `)

  const { rows } = await pool.query(`
    UPDATE disciplinas SET usa_precio_profesor = true
    WHERE nombre_d ILIKE '%natac%'
    RETURNING id_disciplina, nombre_d, usa_precio_profesor
  `)
  console.log('Actualizado:', rows)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
