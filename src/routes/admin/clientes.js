import bcrypt from 'bcrypt'
import { query, pool } from '../../config/database.js'

export default async function clientesRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador', 'Recepcion')] }

  // GET /api/admin/clientes
  // Devuelve lista de clientes con su DNI y rol, sin datos sensibles
  app.get('/', admin, async () => {
    const { rows } = await query(`
      SELECT c.id_cliente, c.nomap_c, c.activo_c, c.venc_ficha_medica,
             u.dni_u, u.rol_u
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      ORDER BY c.nomap_c
    `)
    return rows
  })

  // GET /api/admin/clientes/:id — con inscripciones y suscripción activa
  // Devuelve 404 si no existe el cliente, o si el cliente existe pero no tiene usuario activo
  app.get('/:id', admin, async (req, reply) => {
    const { rows } = await query(`
      SELECT c.*, u.dni_u, u.rol_u, u.activo_u
      FROM clientes c JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE c.id_cliente = $1
    `, [req.params.id])
    if (!rows[0]) return reply.code(404).send({ error: 'Cliente no encontrado' })

    const { rows: inscripciones } = await query(`
      SELECT i.id_inscripto, a.nombre_a, d.nombre_d, i.fecha_inscripcion,
             s.pago_s, s.fecha_s, s.cantidad_dias, s.inasistencias_s
      FROM inscripcion i
      JOIN actividades a ON a.id_actividad = i.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN suscripciones s ON s.id_inscripto = i.id_inscripto
      WHERE i.id_cliente = $1
      ORDER BY i.fecha_inscripcion DESC
    `, [req.params.id])

    return { ...rows[0], inscripciones }
  })

  // POST /api/admin/clientes — crea Usuario + Cliente en transacción
  // crea un nuevo cliente con su usuario asociado, ambos activos por defecto. Devuelve 409 si el DNI ya existe
  app.post('/', {
    ...admin,
    schema: {
      body: {
        type: 'object',
        required: ['dni', 'contrasena', 'nombre_apellido'],
        properties: {
          dni:              { type: 'integer' },
          contrasena:       { type: 'string', minLength: 4 },
          nombre_apellido:  { type: 'string' },
          venc_ficha_medica: { type: 'string', format: 'date' },
          permiso_salida:   { type: 'boolean' },
          permiso_fotos:    { type: 'boolean' },
        }
      }
    }
  }, async (req, reply) => {
    const { dni, contrasena, nombre_apellido, venc_ficha_medica } = req.body
    const hash = await bcrypt.hash(contrasena, 10)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: [usuario] } = await client.query(
        `INSERT INTO usuarios (dni_u, password_u, rol_u, activo_u)
         VALUES ($1, $2, 'Cliente', true) RETURNING id_usuario`,
        [dni, hash]
      )
      const { rows: [nuevoCliente] } = await client.query(
        `INSERT INTO clientes (id_usuario, nomap_c, huella_c, activo_c, venc_ficha_medica)
         VALUES ($1, $2, '', true, $3) RETURNING id_cliente`,
        [usuario.id_usuario, nombre_apellido, venc_ficha_medica || null]
      )
      await client.query('COMMIT')
      return reply.code(201).send({
        id_usuario: usuario.id_usuario,
        id_cliente: nuevoCliente.id_cliente,
        nombre_apellido,
        dni
      })
    } catch (e) {
      await client.query('ROLLBACK')
      if (e.code === '23505') return reply.code(409).send({ error: 'El DNI ya está registrado' })
      throw e
    } finally {
      client.release()
    }
  })

  // PUT /api/admin/clientes/:id
  // Actualiza datos del cliente (nombre_apellido, venc_ficha_medica, activo)
  app.put('/:id', admin, async (req, reply) => {
    const { nombre_apellido, venc_ficha_medica, activo } = req.body
    const { rows } = await query(
      `UPDATE clientes SET
        nomap_c          = COALESCE($1, nomap_c),
        venc_ficha_medica = COALESCE($2, venc_ficha_medica),
        activo_c         = COALESCE($3, activo_c)
       WHERE id_cliente = $4
       RETURNING *`,
      [nombre_apellido, venc_ficha_medica, activo, req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Cliente no encontrado' })
    return rows[0]
  })
}