import bcrypt from 'bcrypt'
import { query } from '../config/database.js'

export default async function authRoutes(app) {

  // POST /api/auth/login
  // Valida el DNI y contraseña, y devuelve un JWT si son correctos
  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['dni', 'password'],
        properties: {
          dni:       { type: 'integer' },
          password: { type: 'string', minLength: 4 },
        }
      }
    }
  }, async (req, reply) => {
    const { dni, password } = req.body

    const { rows } = await query(
      `SELECT u.id_usuario, u.dni_u, u.password_u, u.rol_u, u.activo_u,
              COALESCE(c.nomap_c, p.nomap_p) AS nombre
       FROM usuarios u
       LEFT JOIN clientes  c ON c.id_usuario = u.id_usuario
       LEFT JOIN profesores p ON p.id_usuario = u.id_usuario
       WHERE u.dni_u = $1`,
      [dni]
    )

    const user = rows[0]
    if (!user)          return reply.code(401).send({ error: 'DNI o contraseña incorrectos' })
    if (!user.activo_u) return reply.code(403).send({ error: 'Usuario inactivo' })

    const valid = await bcrypt.compare(password, user['password_u'])
    if (!valid) return reply.code(401).send({ error: 'DNI o contraseña incorrectos' })

    const token = app.jwt.sign({
      id:     user.id_usuario,
      dni:    user.dni_u,
      nombre: user.nombre,
      rol:    user.rol_u,
    })

    return {
      token,
      user: {
        id:     user.id_usuario,
        dni:    user.dni_u,
        nombre: user.nombre,
        rol:    user.rol_u,
      }
    }
  })

  // GET /api/auth/me
  // Devuelve los datos del usuario autenticado (sin contraseña)
  app.get('/me', {
    preHandler: [app.authenticate]
  }, async (req) => {
    const { rows } = await query(
      `SELECT u.id_usuario, u.dni_u, u.rol_u, u.activo_u,
              COALESCE(c.nomap_c, p.nomap_p) AS nombre
       FROM usuarios u
       LEFT JOIN clientes  c ON c.id_usuario = u.id_usuario
       LEFT JOIN profesores p ON p.id_usuario = u.id_usuario
       WHERE u.id_usuario = $1`,
      [req.user.id]
    )
    return rows[0]
  })
}