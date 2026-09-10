// Reemplaza clientes.huella_c (una sola huella) por una tabla de huellas
// múltiples por cliente — para poder reintentar el enrolamiento con otro
// dedo sin perder los anteriores. También agrega un PIN de acceso alternativo
// para clientes a los que no les toma bien la huella (sobre todo niños): el
// PIN se ingresa en el teclado del molinete, que todavía hay que integrar
// aparte (eso queda para más adelante). Acá solo se deja el modelo de datos
// listo: quién tiene huella(s), quién tiene PIN, y con qué método entró cada
// vez (asistencia_cliente.metodo).
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
    CREATE TABLE IF NOT EXISTS huellas_cliente (
      id_huella      BIGSERIAL PRIMARY KEY,
      id_cliente     BIGINT NOT NULL REFERENCES clientes(id_cliente) ON DELETE CASCADE,
      template_huella TEXT NOT NULL,
      etiqueta       VARCHAR(50),
      creado_en      TIMESTAMP NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_huellas_cliente_cliente ON huellas_cliente (id_cliente)
  `)

  // Migrar la huella única existente (si la había) como la primera de la lista
  const { rowCount } = await pool.query(`
    INSERT INTO huellas_cliente (id_cliente, template_huella, etiqueta)
    SELECT id_cliente, huella_c, 'Huella 1'
    FROM clientes
    WHERE huella_c IS NOT NULL AND huella_c <> ''
      AND NOT EXISTS (SELECT 1 FROM huellas_cliente hc WHERE hc.id_cliente = clientes.id_cliente)
  `)
  console.log(`${rowCount} huella(s) existente(s) migrada(s)`)

  await pool.query(`ALTER TABLE clientes DROP COLUMN IF EXISTS huella_c`)

  await pool.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pin_acceso_c VARCHAR(10)`)
  const { rows: [yaUnique] } = await pool.query(`
    SELECT 1 FROM pg_constraint WHERE conname = 'clientes_pin_acceso_c_unique'
  `)
  if (!yaUnique) {
    await pool.query(`ALTER TABLE clientes ADD CONSTRAINT clientes_pin_acceso_c_unique UNIQUE (pin_acceso_c)`)
  }

  await pool.query(`ALTER TABLE asistencia_cliente ADD COLUMN IF NOT EXISTS metodo VARCHAR(10) NOT NULL DEFAULT 'huella'`)
  const { rows: [yaCheck] } = await pool.query(`
    SELECT 1 FROM pg_constraint WHERE conname = 'asistencia_cliente_metodo_check'
  `)
  if (!yaCheck) {
    await pool.query(`ALTER TABLE asistencia_cliente ADD CONSTRAINT asistencia_cliente_metodo_check CHECK (metodo IN ('huella','pin'))`)
  }

  console.log('Listo: huellas_cliente, clientes.pin_acceso_c, asistencia_cliente.metodo')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
