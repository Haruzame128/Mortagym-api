import { query } from '../../config/database.js'

export default async function cuposDisponiblesRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso('clientes.ver')] }

  // GET /api/admin/cupos-disponibles?disciplina=6
  // "Se liberó un lugar, a quién llamo": horarios con lugar libre en
  // disciplinas con lista de espera, cruzados con cuánta gente los espera.
  app.get('/', ver, async (req) => {
    const { disciplina } = req.query
    const condiciones = []
    const params = []

    if (disciplina) {
      params.push(Number(disciplina))
      condiciones.push(`id_disciplina = $${params.length}`)
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''
    const { rows } = await query(
      `SELECT * FROM v_cupos_disponibles ${where} ORDER BY disciplina, dia_h, hora_h`,
      params,
    )
    return rows.map((r) => ({
      ...r,
      lugares_libres: Number(r.lugares_libres),
      en_espera: Number(r.en_espera),
    }))
  })
}
