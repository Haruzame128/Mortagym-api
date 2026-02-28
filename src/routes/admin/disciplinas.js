import { query } from '../../config/database.js'

export default async function disciplinasRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }

  // GET /api/admin/disciplinas
  // Devuelve todas las disciplinas con sus precios (JOIN)
  app.get('/', admin, async () => {
    const { rows } = await query(`
      SELECT d.id_disciplina, d.nombre_d, d.descripcion_d,
             p.precio_1, p.precio_2, p.precio_3,
             p.precio_4, p.precio_5, p.precio_6, p.precio_dia
      FROM disciplinas d
      JOIN precios p ON p.id_precio = d.id_precio
      ORDER BY d.nombre_d
    `)
    return rows
  })

  // POST /api/admin/disciplinas — crea Disciplina + Precios en transacción
  app.post('/', {
    ...admin,
    schema: {
      body: {
        type: 'object',
        required: ['nombre', 'descripcion', 'precios'],
        properties: {
          nombre:      { type: 'string' },
          descripcion: { type: 'string' },
          precios: {
            type: 'object',
            required: ['precio_1','precio_dia'],
            properties: {
              precio_1:   { type: 'integer' },
              precio_2:   { type: 'integer' },
              precio_3:   { type: 'integer' },
              precio_4:   { type: 'integer' },
              precio_5:   { type: 'integer' },
              precio_6:   { type: 'integer' },
              precio_dia: { type: 'integer' },
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { nombre, descripcion, precios } = req.body
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Primero se inserta el precio (la FK va de Disciplinas → Precios)
      const { rows: [precio] } = await client.query(
        `INSERT INTO precios (id_disciplina, precio_1, precio_2, precio_3, precio_4, precio_5, precio_6, precio_dia)
         VALUES (0, $1, $2, $3, $4, $5, $6, $7) RETURNING id_precio`,
        [precios.precio_1, precios.precio_2||0, precios.precio_3||0,
         precios.precio_4||0, precios.precio_5||0, precios.precio_6||0, precios.precio_dia]
      )
      const { rows: [disc] } = await client.query(
        `INSERT INTO disciplinas (nombre_d, descripcion_d, id_precio)
         VALUES ($1, $2, $3) RETURNING *`,
        [nombre, descripcion, precio.id_precio]
      )
      // Actualizar la FK circular en Precios
      await client.query(
        `UPDATE precios SET id_disciplina = $1 WHERE id_precio = $2`,
        [disc.id_disciplina, precio.id_precio]
      )
      await client.query('COMMIT')
      return reply.code(201).send({ ...disc, ...precios })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // PUT /api/admin/disciplinas/:id
  // Actualiza Disciplina y/o Precios en transacción (solo campos enviados)
  app.put('/:id', admin, async (req, reply) => {
    const { nombre, descripcion, precios } = req.body
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: [disc] } = await client.query(
        `UPDATE disciplinas SET
          nombre_d      = COALESCE($1, nombre_d),
          descripcion_d = COALESCE($2, descripcion_d)
         WHERE id_disciplina = $3 RETURNING *`,
        [nombre, descripcion, req.params.id]
      )
      if (!disc) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Disciplina no encontrada' }) }

      if (precios) {
        await client.query(
          `UPDATE precios SET
            precio_1   = COALESCE($1, precio_1),
            precio_2   = COALESCE($2, precio_2),
            precio_3   = COALESCE($3, precio_3),
            precio_4   = COALESCE($4, precio_4),
            precio_5   = COALESCE($5, precio_5),
            precio_6   = COALESCE($6, precio_6),
            precio_dia = COALESCE($7, precio_dia)
           WHERE id_precio = $8`,
          [precios.precio_1, precios.precio_2, precios.precio_3,
           precios.precio_4, precios.precio_5, precios.precio_6,
           precios.precio_dia, disc.id_precio]
        )
      }
      await client.query('COMMIT')
      return { message: 'Disciplina actualizada' }
    } catch(e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })
}