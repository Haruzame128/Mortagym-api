import { query } from '../config/database.js'

const UN_DIA_MS = 24 * 60 * 60 * 1000

// Pasa a 'vencido' los contratos de profesor cuya fecha_vencimiento ya pasó
// y desactiva al profesor (misma función que usa scripts/vencer_contratos_cron.js
// para ejecución manual/externa).
export async function vencerContratosVencidos() {
  try {
    const { rows: [{ vencer_contratos_profesor: cerrados }] } = await query(
      `SELECT vencer_contratos_profesor()`
    )
    if (cerrados > 0) {
      console.log(`[${new Date().toISOString()}] Contratos vencidos cerrados: ${cerrados}`)
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error al vencer contratos:`, err.message)
  }
}

export function iniciarJobContratosVencidos() {
  vencerContratosVencidos()
  setInterval(vencerContratosVencidos, UN_DIA_MS)
}
