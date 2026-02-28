import bcrypt from 'bcrypt'
import { query } from '../../config/database.js'

export default async function usuariosRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }

  // GET /api/admin/usuarios
  // Devuelve una lista de todos los usuarios (sin contraseñas)
  app.get('/', admin, async () => {
    const { rows } = await query(
      `SELECT id_usuario, dni_u, rol_u, activo_u FROM usuarios ORDER BY id_usuario`
    )
    return rows
  })

  // GET /api/admin/usuarios/:id
  // Devuelve los detalles de un usuario específico (sin contraseña)
  app.get('/:id', admin, async (req, reply) => {
    const { rows } = await query(
      `SELECT id_usuario, dni_u, rol_u, activo_u FROM usuarios WHERE id_usuario = $1`,
      [req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Usuario no encontrado' })
    return rows[0]
  })

  // POST /api/admin/usuarios
  // Crea un nuevo usuario. El cuerpo debe incluir dni, contrasena y rol. Devuelve el nuevo usuario (sin contraseña).
  app.post('/', {
    ...admin,
    schema: {
      body: {
        type: 'object',
        required: ['dni', 'contrasena', 'rol'],
        properties: {
          dni:       { type: 'integer' },
          contrasena: { type: 'string', minLength: 4 },
          rol:       { type: 'string', enum: ['Cliente', 'Profesor', 'Administrador', 'Recepcion'] },
        }
      }
    }
  }, async (req, reply) => {
    const { dni, contrasena, rol } = req.body
    const hash = await bcrypt.hash(contrasena, 10)
    try {
      const { rows } = await query(
        `INSERT INTO usuarios (dni_u, contraseña_u, rol_u, activo_u)
         VALUES ($1, $2, $3, true) RETURNING id_usuario, dni_u, rol_u`,
        [dni, hash, rol]
      )
      return reply.code(201).send(rows[0])
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'El DNI ya está registrado' })
      throw e
    }
  })

  // PUT /api/admin/usuarios/:id
  // Actualiza el rol, estado activo o contraseña de un usuario. El cuerpo puede incluir cualquiera de estos campos. Devuelve el usuario actualizado (sin contraseña).
  app.put('/:id', {
    ...admin,
    schema: {
      body: {
        type: 'object',
        properties: {
          rol:      { type: 'string', enum: ['Cliente', 'Profesor', 'Administrador', 'Recepcion'] },
          activo:   { type: 'boolean' },
          contrasena: { type: 'string', minLength: 4 },
        }
      }
    }
  }, async (req, reply) => {
    const { rol, activo, contrasena } = req.body
    let hash = undefined
    if (contrasena) hash = await bcrypt.hash(contrasena, 10)

    const { rows } = await query(
      `UPDATE usuarios SET
        rol_u       = COALESCE($1, rol_u),
        activo_u    = COALESCE($2, activo_u),
        contraseña_u = COALESCE($3, contraseña_u)
       WHERE id_usuario = $4
       RETURNING id_usuario, dni_u, rol_u, activo_u`,
      [rol, activo, hash, req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Usuario no encontrado' })
    return rows[0]
  })

  // DELETE /api/admin/usuarios/:id — soft delete
  // En lugar de eliminar el usuario, se marca como inactivo. Devuelve un mensaje de éxito o error.
  app.delete('/:id', admin, async (req, reply) => {
    const { rows } = await query(
      `UPDATE usuarios SET activo_u = false WHERE id_usuario = $1 RETURNING id_usuario`,
      [req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Usuario no encontrado' })
    return { message: 'Usuario desactivado' }
  })
}