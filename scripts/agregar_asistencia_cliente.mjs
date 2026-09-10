// Historial de ingresos por huella al gimnasio. Se registra cada intento de
// acceso (autorizado o denegado) para poder auditar el molinete después:
// quién entró, cuándo, y por qué se le negó el paso si fue el caso.
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
    CREATE TABLE IF NOT EXISTS asistencia_cliente (
      id_asistencia  BIGSERIAL PRIMARY KEY,
      id_cliente     BIGINT REFERENCES clientes(id_cliente),
      dni_ingresado  BIGINT NOT NULL,
      id_suscripcion BIGINT REFERENCES suscripciones(id_suscripcion),
      fecha_hora     TIMESTAMP NOT NULL DEFAULT now(),
      permitido      BOOLEAN NOT NULL,
      motivo         VARCHAR(30) NOT NULL,
      mensaje        TEXT
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_asistencia_cliente_cliente
      ON asistencia_cliente (id_cliente, fecha_hora DESC)
  `)
  console.log('Tabla asistencia_cliente creada')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
