import bcrypt from 'bcrypt'
import { query } from '../config/database.js'

export default async function authRoutes(app) {

  // POST /api/auth/login
  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['dni', 'contrasena'],
        properties: {
          dni:        { type: 'integer' },
          contrasena: { type: 'string', minLength: 4 },
        }
      }
    }
  }, async (req, reply) => {
    const { dni, contrasena } = req.body

    const { rows } = await query(
      `SELECT u.id_usuario        AS id,
              u.dni_u             AS dni,
              u.password_u        AS password,
              u.rol_u             AS rol,
              u.activo_u          AS activo,
              COALESCE(c.nomap_c, p.nomap_p) AS nombre
       FROM usuarios u
       LEFT JOIN clientes   c ON c.id_usuario = u.id_usuario
       LEFT JOIN profesores p ON p.id_usuario = u.id_usuario
       WHERE u.dni_u = $1`,
      [dni]
    )
    console.log('DNI recibido:', dni, typeof dni)
    console.log('ROWS:', rows)
    const user = rows[0]
    if (!user)        return reply.code(401).send({ error: 'DNI o contraseña incorrectos' })
    if (!user.activo) return reply.code(403).send({ error: 'Usuario inactivo' })

    const valid = await bcrypt.compare(contrasena, user.password)
    if (!valid) return reply.code(401).send({ error: 'DNI o contraseña incorrectos' })

    const token = app.jwt.sign({
      id:     user.id,
      dni:    user.dni,
      nombre: user.nombre,
      rol:    user.rol,
    })

    return {
      token,
      user: {
        id:     user.id,
        dni:    user.dni,
        nombre: user.nombre,
        rol:    user.rol,
      }
    }
  })

  // GET /api/auth/me
  app.get('/me', {
    preHandler: [app.authenticate]
  }, async (req) => {
    const { rows } = await query(
      `SELECT u.id_usuario AS id,
              u.dni_u      AS dni,
              u.rol_u      AS rol,
              u.activo_u   AS activo,
              COALESCE(c.nomap_c, p.nomap_p) AS nombre
       FROM usuarios u
       LEFT JOIN clientes   c ON c.id_usuario = u.id_usuario
       LEFT JOIN profesores p ON p.id_usuario = u.id_usuario
       WHERE u.id_usuario = $1`,
      [req.user.id]
    )
    return rows[0]
  })
}