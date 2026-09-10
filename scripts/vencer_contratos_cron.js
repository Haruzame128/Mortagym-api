import { query, pool } from '../src/config/database.js'
import 'dotenv/config'

async function vencerContratos() {
  try {
    const { rows: [{ vencer_contratos_profesor: cerrados }] } = await query(
      `SELECT vencer_contratos_profesor()`
    )
    console.log(`[${new Date().toISOString()}] Contratos vencidos cerrados: ${cerrados}`)
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error al vencer contratos:`, err.message)
    throw err
  } finally {
    await pool.end()
  }
}

vencerContratos()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
