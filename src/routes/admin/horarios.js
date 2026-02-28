import { query } from '../../config/database.js'

const DIAS = ['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado']

export default async function horariosRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }

  // GET /api/admin/horarios
  // Devuelve todos los horarios con detalles de actividad, disciplina y profesor
  app.get('/', admin, async () => {
    const { rows } = await query(`
      SELECT h.id_horario, h.dia_h, h.hora_h, h.cupo_maximo, h.cupo_actual,
             a.nombre_a, d.nombre_d, p.nomap_p AS profesor
      FROM horarios h
      JOIN actividades a ON a.id_actividad = h.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      JOIN profesores p ON p.id_profesor = a.id_profesor
      ORDER BY
        ARRAY_POSITION(ARRAY['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'], h.dia_h),
        h.hora_h
    `)
    return rows
  })

  // POST /api/admin/horarios
  // Crea un nuevo horario para una actividad existente
  app.post('/', {
    ...admin,
    schema: {
      body: {
        type: 'object',
        required: ['id_actividad', 'dia', 'hora', 'cupo_maximo'],
        properties: {
          id_actividad: { type: 'integer' },
          dia:          { type: 'string', enum: DIAS },
          hora:         { type: 'string' }, // 'HH:MM'
          cupo_maximo:  { type: 'integer', minimum: 1 },
        }
      }
    }
  }, async (req, reply) => {
    const { id_actividad, dia, hora, cupo_maximo } = req.body
    const { rows } = await query(
      `INSERT INTO horarios (id_actividad, dia_h, hora_h, cupo_maximo, cupo_actual)
       VALUES ($1, $2, $3, $4, 0) RETURNING *`,
      [id_actividad, dia, hora, cupo_maximo]
    )
    return reply.code(201).send(rows[0])
  })

  // PUT /api/admin/horarios/:id
  // Actualiza un horario existente (solo campos proporcionados)
  app.put('/:id', admin, async (req, reply) => {
    const { dia, hora, cupo_maximo } = req.body
    const { rows } = await query(
      `UPDATE horarios SET
        dia_h      = COALESCE($1, dia_h),
        hora_h     = COALESCE($2, hora_h),
        cupo_maximo  = COALESCE($3, cupo_maximo)
       WHERE id_horario = $4 RETURNING *`,
      [dia, hora, cupo_maximo, req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Horario no encontrado' })
    return rows[0]
  })

  // DELETE /api/admin/horarios/:id
  // Elimina un horario por su ID
  app.delete('/:id', admin, async (req, reply) => {
    await query(`DELETE FROM horarios WHERE id_horario = $1`, [req.params.id])
    return { message: 'Horario eliminado' }
  })
}