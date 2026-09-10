import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

export const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  max: 10,                    // máximo de conexiones (PgBouncer ya maneja el pool, esto es el pool local)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // El servidor corre en UTC. Sin esto, CURRENT_DATE/now() se adelantan a
  // "mañana" desde ~21hs hora Argentina (movimientos, revisaciones, contratos,
  // todo lo que dependa de la fecha del día se ve afectado). Va como parámetro
  // de arranque de la conexión (sin query aparte, sin carreras con el pool).
  // Se fija también a nivel de base con ALTER DATABASE, como red de
  // seguridad por si se levanta contra una base que no la tenga configurada.
  options: '-c timezone=America/Argentina/Buenos_Aires',
})

// Test de conexión al arrancar
pool.connect()
  .then(c => { console.log('✅ PostgreSQL conectado'); c.release() })
  .catch(e => { console.error('❌ Error DB:', e.message); process.exit(1) })

export const query = (text, params) => pool.query(text, params)