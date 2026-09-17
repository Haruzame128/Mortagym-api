// Normaliza ejercicios.categoria_e (texto libre) en una tabla propia
// categorias_ejercicio, para que la categoría exista independientemente de
// sus ejercicios — hasta ahora, al borrar el único ejercicio de una
// categoría, la categoría "desaparecía" (era solo un string en esa fila).
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
    CREATE TABLE IF NOT EXISTS categorias_ejercicio (
      id_categoria     BIGSERIAL PRIMARY KEY,
      nombre_categoria VARCHAR(50) NOT NULL UNIQUE,
      creado_en        TIMESTAMP NOT NULL DEFAULT now()
    )
  `)

  // Migrar las categorías (texto libre) ya existentes en ejercicios
  const { rowCount: catsMigradas } = await pool.query(`
    INSERT INTO categorias_ejercicio (nombre_categoria)
    SELECT DISTINCT categoria_e FROM ejercicios
    ON CONFLICT (nombre_categoria) DO NOTHING
  `)
  console.log(`${catsMigradas} categoría(s) migrada(s)`)

  await pool.query(`ALTER TABLE ejercicios ADD COLUMN IF NOT EXISTS id_categoria BIGINT`)

  await pool.query(`
    UPDATE ejercicios e SET id_categoria = c.id_categoria
    FROM categorias_ejercicio c
    WHERE c.nombre_categoria = e.categoria_e AND e.id_categoria IS NULL
  `)

  await pool.query(`ALTER TABLE ejercicios ALTER COLUMN id_categoria SET NOT NULL`)

  const { rows: [yaFk] } = await pool.query(`
    SELECT 1 FROM pg_constraint WHERE conname = 'ejercicios_id_categoria_fkey'
  `)
  if (!yaFk) {
    await pool.query(`
      ALTER TABLE ejercicios
      ADD CONSTRAINT ejercicios_id_categoria_fkey
      FOREIGN KEY (id_categoria) REFERENCES categorias_ejercicio(id_categoria) ON DELETE RESTRICT
    `)
  }

  await pool.query(`ALTER TABLE ejercicios DROP COLUMN IF EXISTS categoria_e`)

  console.log('Listo: categorias_ejercicio creada, ejercicios.id_categoria enlazado')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
