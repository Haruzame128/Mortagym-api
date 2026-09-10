// "Apto médico" — el certificado físico que el cliente entrega en persona
// (firmado por un médico) para que quede archivado en el gimnasio. Es
// DISTINTO de la ficha_medica digital que se completa en el formulario de
// inscripción: acá solo importa si el papel físico fue entregado, cuándo, y
// cuándo vence (un año desde la entrega, igual que la matrícula).
//
// Reusa la columna clientes.venc_ficha_medica que ya existía (y ya se usaba
// para mostrar el vencimiento en el perfil del cliente / acceso), pero hasta
// ahora no había forma en la interfaz de cargarla: se agrega
// fecha_entrega_ficha_medica para que el vencimiento se calcule solo
// (entrega + 1 año) en vez de tipearse a mano.
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
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS fecha_entrega_ficha_medica DATE
  `)
  console.log('Columna fecha_entrega_ficha_medica agregada a clientes')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
