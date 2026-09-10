import { query, pool } from '../src/config/database.js'
import 'dotenv/config'

async function darBajaClientes() {
  try {
    const { rows: [{ dar_baja_clientes_inactivos: dados_de_baja }] } = await query(
      `SELECT dar_baja_clientes_inactivos()`
    )
    console.log(`[${new Date().toISOString()}] Clientes dados de baja por inactividad: ${dados_de_baja}`)
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error al dar de baja clientes:`, err.message)
    throw err
  } finally {
    await pool.end()
  }
}

darBajaClientes()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
