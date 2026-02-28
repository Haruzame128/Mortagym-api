import { query, pool } from '../config/database.js'

export default async function reservasRoutes(app) {

  // ── MUSCULACIÓN ──────────────────────────────────────────────

  // GET /api/reservas/musculacion/disponibles?dia=Lunes
  // Devuelve horarios de musculación con cupos disponibles para un día dado
  app.get('/musculacion/disponibles', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        required: ['dia'],
        properties: {
          dia: { type: 'string', enum: ['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'] }
        }
      }
    }
  }, async (req) => {
    const { rows } = await query(`
      SELECT h.id_horario, h.hora_h, h.cupo_maximo, h.cupo_actual,
             h.cupo_maximo - h.cupo_actual AS cupos_disponibles
      FROM horarios h
      JOIN actividades a ON a.id_actividad = h.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      WHERE h.dia_h = $1
        AND d.nombre_d ILIKE '%musculacion%'
        AND h.cupo_actual < h.cupo_maximo
      ORDER BY h.hora_h
    `, [req.query.dia])
    return rows
  })

  // POST /api/reservas/musculacion — reservar turno de musculación
  // Cliente reserva un horario específico de musculación, verificando cupos y evitando duplicados
  app.post('/musculacion', {
    preHandler: [app.authenticate, app.authorize('Cliente', 'Administrador', 'Recepcion')],
    schema: {
      body: {
        type: 'object',
        required: ['id_horario'],
        properties: {
          id_horario: { type: 'integer' },
          id_cliente: { type: 'integer' }, // solo Admin/Recepcion puede especificar otro cliente
        }
      }
    }
  }, async (req, reply) => {
    const { id_horario, id_cliente: clienteParam } = req.body
    const db = await pool.connect()
    try {
      await db.query('BEGIN')

      // Resolver id_cliente: si es cliente, usa el suyo; admin puede pasar otro
      let id_cliente = clienteParam
      if (req.user.rol === 'Cliente') {
        const { rows: [c] } = await db.query(
          `SELECT id_cliente FROM clientes WHERE id_usuario = $1`, [req.user.id]
        )
        if (!c) return reply.code(403).send({ error: 'Cliente no encontrado' })
        id_cliente = c.id_cliente
      }

      // Verificar cupos con lock
      const { rows: [horario] } = await db.query(
        `SELECT cupo_maximo, cupo_actual FROM horarios WHERE id_horario = $1 FOR UPDATE`,
        [id_horario]
      )
      if (!horario) return reply.code(404).send({ error: 'Horario no encontrado' })
      if (horario.cupo_actual >= horario.cupo_maximo) {
        await db.query('ROLLBACK')
        return reply.code(409).send({ error: 'No hay cupos disponibles' })
      }

      // Verificar reserva duplicada
      const { rows: [exist] } = await db.query(
        `SELECT id_reserva_musculacion FROM reserva_musculacion
         WHERE id_cliente = $1 AND id_horario = $2`,
        [id_cliente, id_horario]
      )
      if (exist) {
        await db.query('ROLLBACK')
        return reply.code(409).send({ error: 'Ya tenés una reserva en este horario' })
      }

      // Insertar reserva y actualizar cupo
      const { rows: [reserva] } = await db.query(
        `INSERT INTO reserva_musculacion (id_cliente, id_horario)
         VALUES ($1, $2) RETURNING *`,
        [id_cliente, id_horario]
      )
      await db.query(
        `UPDATE horarios SET cupo_actual = cupo_actual + 1 WHERE id_horario = $1`,
        [id_horario]
      )

      await db.query('COMMIT')
      return reply.code(201).send(reserva)
    } catch(e) {
      await db.query('ROLLBACK')
      throw e
    } finally {
      db.release()
    }
  })

  // DELETE /api/reservas/musculacion/:id — cancelar reserva de musculación
  // Cliente puede cancelar su propia reserva; admin puede cancelar cualquiera
  app.delete('/musculacion/:id', {
    preHandler: [app.authenticate]
  }, async (req, reply) => {
    const { rows: [reserva] } = await query(
      `SELECT r.*, c.id_usuario FROM reserva_musculacion r
       JOIN clientes c ON c.id_cliente = r.id_cliente
       WHERE r.id_reserva_musculacion = $1`,
      [req.params.id]
    )
    if (!reserva) return reply.code(404).send({ error: 'Reserva no encontrada' })

    if (req.user.rol === 'Cliente' && reserva.id_usuario !== req.user.id) {
      return reply.code(403).send({ error: 'Sin permisos para cancelar esta reserva' })
    }

    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      await db.query(`DELETE FROM reserva_musculacion WHERE id_reserva_musculacion = $1`, [req.params.id])
      await db.query(`UPDATE horarios SET cupo_actual = cupo_actual - 1 WHERE id_horario = $1`, [reserva.id_horario])
      await db.query('COMMIT')
      return { message: 'Reserva cancelada' }
    } catch(e) {
      await db.query('ROLLBACK')
      throw e
    } finally {
      db.release()
    }
  })

  // ── INSCRIPCIÓN A ACTIVIDADES ────────────────────────────────

  // GET /api/reservas/inscripciones — mis inscripciones (cliente) o todas (admin)
  // Admin/Recepcion ve todas las inscripciones; Cliente solo las suyas
  app.get('/inscripciones', {
    preHandler: [app.authenticate]
  }, async (req) => {
    const isAdmin = ['Administrador', 'Recepcion'].includes(req.user.rol)
    if (isAdmin) {
      const { rows } = await query(`
        SELECT i.id_inscripto, c.nomAp_C, a.nombre_a, d.nombre_d,
               i.fecha_inscripcion, i.matricula,
               s.pago_S, s.fecha_S, s.cantidad_dias, s.inasistencias_S
        FROM inscripcion i
        JOIN clientes c ON c.id_cliente = i.id_cliente
        JOIN actividades a ON a.id_actividad = i.id_actividad
        JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
        LEFT JOIN suscripciones s ON s.id_inscripto = i.id_inscripto
        ORDER BY i.fecha_inscripcion DESC
      `)
      return rows
    }
    // Cliente: solo ve las suyas
    const { rows } = await query(`
      SELECT i.id_inscripto, a.nombre_a, d.nombre_d,
             i.fecha_inscripcion, i.matricula,
             s.pago_S, s.fecha_S, s.cantidad_dias, s.inasistencias_S
      FROM inscripcion i
      JOIN clientes c ON c.id_cliente = i.id_cliente
      JOIN usuarios u ON u.id_usuario = c.id_usuario AND u.id_usuario = $1
      JOIN actividades a ON a.id_actividad = i.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN suscripciones s ON s.id_inscripto = i.id_inscripto
      ORDER BY i.fecha_inscripcion DESC
    `, [req.user.id])
    return rows
  })

  // POST /api/reservas/inscripciones — inscribir cliente a una actividad
  // Admin/Recepcion puede inscribir a cualquier cliente; Cliente solo a sí mismo
  app.post('/inscripciones', {
    preHandler: [app.authenticate, app.authorize('Administrador', 'Recepcion')],
    schema: {
      body: {
        type: 'object',
        required: ['id_cliente', 'id_actividad'],
        properties: {
          id_cliente:          { type: 'integer' },
          id_actividad:        { type: 'integer' },
          matricula:           { type: 'string', format: 'date' },
          permiso_salida:      { type: 'boolean' },
          permiso_fotos_redes: { type: 'boolean' },
        }
      }
    }
  }, async (req, reply) => {
    const { id_cliente, id_actividad, matricula, permiso_salida, permiso_fotos_redes } = req.body
    try {
      const { rows } = await query(
        `INSERT INTO inscripcion
           (id_cliente, id_actividad, fecha_inscripcion, matricula, permiso_salida, permiso_fotos_redes)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)
         RETURNING *`,
        [id_cliente, id_actividad, matricula || null, permiso_salida ?? null, permiso_fotos_redes ?? null]
      )
      return reply.code(201).send(rows[0])
    } catch(e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'El cliente ya está inscripto en esta actividad' })
      throw e
    }
  })
}