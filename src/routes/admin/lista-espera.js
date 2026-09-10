import { query } from '../../config/database.js'

export default async function listaEsperaRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso('clientes.ver')] }
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso('clientes.crear')] }

  // GET /api/admin/lista-espera?disciplina=6&estado=esperando
  // v_lista_espera no expone id_disciplina (solo el nombre), así que el
  // filtro por id se resuelve contra disciplinas.
  app.get('/', ver, async (req) => {
    const { disciplina, estado } = req.query
    const condiciones = []
    const params = []

    if (disciplina) {
      params.push(Number(disciplina))
      condiciones.push(`disciplina = (SELECT nombre_d FROM disciplinas WHERE id_disciplina = $${params.length})`)
    }
    if (estado) {
      params.push(estado)
      condiciones.push(`estado = $${params.length}`)
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''
    const { rows } = await query(
      `SELECT * FROM v_lista_espera ${where} ORDER BY disciplina, posicion`,
      params,
    )
    return rows.map((r) => ({
      ...r,
      posicion: Number(r.posicion),
      dias_esperando: Number(r.dias_esperando),
      es_cliente: r.es_cliente === true || r.es_cliente === 'true',
    }))
  })

  // POST /api/admin/lista-espera — anotar a alguien
  app.post(
    '/',
    {
      ...gestionar,
      schema: {
        body: {
          type: 'object',
          required: ['id_disciplina', 'nombre'],
          properties: {
            id_disciplina: { type: 'integer' },
            id_actividad: { type: 'integer' },
            id_horario: { type: 'integer' },
            id_cliente: { type: 'integer' },
            nombre: { type: 'string', minLength: 1 },
            telefono: { type: 'string' },
            mail: { type: 'string' },
            dni: { type: 'integer' },
            fecha_nac: { type: 'string' },
            prioridad: { type: 'integer' },
          },
        },
      },
    },
    async (req, reply) => {
      const {
        id_disciplina, id_actividad, id_horario, id_cliente,
        nombre, telefono, mail, dni, fecha_nac, prioridad,
      } = req.body
      try {
        const {
          rows: [row],
        } = await query(
          `
          INSERT INTO lista_espera
            (id_disciplina, id_actividad, id_horario, id_cliente, nombre,
             telefono, mail, dni, fecha_nac, prioridad, id_usuario_carga)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,0),$11)
          RETURNING *
          `,
          [
            id_disciplina, id_actividad || null, id_horario || null, id_cliente || null,
            nombre, telefono || null, mail || null, dni || null, fecha_nac || null,
            prioridad, req.user.id,
          ],
        )
        return reply.code(201).send(row)
      } catch (err) {
        if (err.code === '23505') {
          return reply.code(409).send({ error: 'Ese DNI ya tiene un pedido abierto en esta cola' })
        }
        throw err
      }
    },
  )

  // PATCH /api/admin/lista-espera/:id/estado — mover de estado
  app.patch('/:id/estado', gestionar, async (req, reply) => {
    const { estado, id_cliente, notas } = req.body
    if (!estado) return reply.code(400).send({ error: 'estado es requerido' })

    try {
      await query(`SELECT cerrar_espera($1, $2, $3, $4)`, [
        req.params.id, estado, id_cliente || null, notas || null,
      ])
      const {
        rows: [row],
      } = await query(`SELECT * FROM lista_espera WHERE id_espera = $1`, [req.params.id])
      return row
    } catch (err) {
      if (err.code === 'P0001') {
        const status = /no existe/i.test(err.message) ? 404 : 400
        return reply.code(status).send({ error: err.message })
      }
      throw err
    }
  })

  // PATCH /api/admin/lista-espera/:id/prioridad
  app.patch('/:id/prioridad', gestionar, async (req, reply) => {
    const { prioridad } = req.body
    if (prioridad === undefined) return reply.code(400).send({ error: 'prioridad es requerida' })

    const {
      rows: [row],
    } = await query(
      `UPDATE lista_espera SET prioridad = $1 WHERE id_espera = $2 RETURNING *`,
      [prioridad, req.params.id],
    )
    if (!row) return reply.code(404).send({ error: 'Pedido no encontrado' })
    return row
  })

  // DELETE /api/admin/lista-espera/:id — solo pedidos abiertos
  app.delete('/:id', gestionar, async (req, reply) => {
    const {
      rows: [row],
    } = await query(
      `DELETE FROM lista_espera
       WHERE id_espera = $1 AND estado IN ('esperando','contactado')
       RETURNING id_espera`,
      [req.params.id],
    )
    if (!row) return reply.code(404).send({ error: 'Pedido no encontrado o ya cerrado' })
    return { mensaje: 'Pedido eliminado' }
  })
}
