import { query } from '../../config/database.js'

export default async function actividadesRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }

  // GET /api/admin/actividades
  // Devuelve todas las actividades con su disciplina, profesor y cantidad de horarios asociados
  app.get('/', admin, async () => {
    const { rows } = await query(`
      SELECT a.id_actividad, a.nombre_a, a.max_inasistencia,
             d.nombre_d, p.nomap_p AS profesor,
             COUNT(h.id_horario) AS cantidad_horarios
      FROM actividades a
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      JOIN profesores p ON p.id_profesor = a.id_profesor
      LEFT JOIN horarios h ON h.id_actividad = a.id_actividad
      GROUP BY a.id_actividad, a.nombre_a, a.max_inasistencia, d.nombre_d, p.nomap_p
      ORDER BY a.nombre_a
    `)
    return rows
  })

  // POST /api/admin/actividades
  // Crea una nueva actividad
  app.post('/', {
    ...admin,
    schema: {
      body: {
        type: 'object',
        required: ['id_disciplina', 'nombre', 'id_profesor', 'max_inasistencia'],
        properties: {
          id_disciplina:    { type: 'integer' },
          nombre:           { type: 'string' },
          id_profesor:      { type: 'integer' },
          max_inasistencia: { type: 'integer' },
        }
      }
    }
  }, async (req, reply) => {
    const { id_disciplina, nombre, id_profesor, max_inasistencia } = req.body
    const { rows } = await query(
      `INSERT INTO actividades (id_disciplina, nombre_a, id_profesor, max_inasistencia)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id_disciplina, nombre, id_profesor, max_inasistencia]
    )
    return reply.code(201).send(rows[0])
  })

  // PUT /api/admin/actividades/:id
  // Actualiza una actividad existente (solo los campos proporcionados)
  app.put('/:id', admin, async (req, reply) => {
    const { nombre, id_profesor, max_inasistencia } = req.body
    const { rows } = await query(
      `UPDATE actividades SET
        nombre_a        = COALESCE($1, nombre_a),
        id_profesor       = COALESCE($2, id_profesor),
        max_inasistencia  = COALESCE($3, max_inasistencia)
       WHERE id_actividad = $4 RETURNING *`,
      [nombre, id_profesor, max_inasistencia, req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Actividad no encontrada' })
    return rows[0]
  })

  // DELETE /api/admin/actividades/:id
  // Elimina una actividad por su ID
  app.delete('/:id', admin, async (req, reply) => {
    await query(`DELETE FROM actividades WHERE id_actividad = $1`, [req.params.id])
    return { message: 'Actividad eliminada' }
  })
}