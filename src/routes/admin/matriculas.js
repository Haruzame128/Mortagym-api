import { query } from '../../config/database.js'

export default async function matriculasRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso('clientes.ver')] }
  const cobrar = { preHandler: [app.authenticate, app.requierePermiso('finanzas.registrar')] }

  // GET /api/admin/matriculas?paga=false&anio=2026&disciplina=6&buscar=texto
  app.get('/', ver, async (req) => {
    const { paga, anio, disciplina, buscar } = req.query
    const condiciones = []
    const params = []

    if (paga !== undefined) {
      params.push(paga === 'true')
      condiciones.push(`paga = $${params.length}`)
    }
    if (anio) {
      params.push(Number(anio))
      condiciones.push(`anio_actual = $${params.length}`)
    }
    if (disciplina) {
      params.push(Number(disciplina))
      condiciones.push(`id_disciplina = $${params.length}`)
    }
    if (buscar) {
      params.push(`%${buscar}%`)
      condiciones.push(`(nomap_c ILIKE $${params.length} OR dni_u::text ILIKE $${params.length})`)
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''
    const { rows } = await query(
      `SELECT * FROM v_matriculas_estado ${where} ORDER BY paga ASC, nomap_c ASC`,
      params,
    )
    // El driver puede entregar boolean como string.
    return rows.map((r) => ({ ...r, paga: r.paga === true || r.paga === 'true' }))
  })

  // POST /api/admin/matriculas — registrar el cobro
  app.post(
    '/',
    {
      ...cobrar,
      schema: {
        body: {
          type: 'object',
          required: ['id_cliente', 'id_disciplina'],
          properties: {
            id_cliente: { type: 'integer' },
            id_disciplina: { type: 'integer' },
            medio_pago: {
              type: 'string',
              enum: ['Efectivo', 'Debito', 'Transferencia', 'Credito', 'Otro'],
            },
            observaciones: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { id_cliente, id_disciplina, medio_pago, observaciones } = req.body

      // El precio de matrícula varía según cuántos días por semana asiste el
      // cliente a esa disciplina — se toma de su inscripción vigente, nunca
      // se le pregunta a quien cobra (así siempre coincide con lo que paga
      // de cuota).
      const {
        rows: [{ cantidad_dias }],
      } = await query(
        `SELECT MAX(s.cantidad_dias) AS cantidad_dias
         FROM inscripcion i
         JOIN actividades a ON a.id_actividad = i.id_actividad
         JOIN LATERAL (
           SELECT cantidad_dias FROM suscripciones s2
           WHERE s2.id_inscripto = i.id_inscripto
           ORDER BY s2.fecha_s DESC, s2.id_suscripcion DESC LIMIT 1
         ) s ON true
         WHERE i.id_cliente = $1 AND a.id_disciplina = $2`,
        [id_cliente, id_disciplina],
      )
      if (cantidad_dias == null) {
        return reply.code(400).send({ error: 'No se pudo determinar los días por semana del cliente en esa disciplina' })
      }

      try {
        const {
          rows: [{ registrar_matricula: id_matricula }],
        } = await query(
          `SELECT registrar_matricula(
             p_id_cliente => $1, p_id_disciplina => $2, p_id_usuario => $3,
             p_medio_pago => $4, p_observaciones => $5, p_cantidad_dias => $6
           ) AS registrar_matricula`,
          [id_cliente, id_disciplina, req.user.id, medio_pago || 'Efectivo', observaciones || null, cantidad_dias],
        )
        const {
          rows: [matricula],
        } = await query(`SELECT * FROM matriculas WHERE id_matricula = $1`, [id_matricula])
        return reply.code(201).send(matricula)
      } catch (err) {
        if (err.code === '23505') {
          return reply.code(409).send({ error: 'Ese cliente ya tiene pagada la matrícula de esa disciplina este año' })
        }
        if (err.code === 'P0001') {
          return reply.code(400).send({ error: err.message })
        }
        throw err
      }
    },
  )
}
