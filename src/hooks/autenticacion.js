import { rolTienePermiso } from '../services/permisos.js'

export function registerAuthHooks(app) {

  // Verifica JWT válido
  app.decorate('authenticate', async function(req, reply) {
    try {
      await req.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Token inválido o expirado' })
    }
  })

  // Verifica rol — uso: app.authorize('Administrador', 'Recepcion')
  app.decorate('authorize', function(...roles) {
    return async function(req, reply) {
      if (!roles.includes(req.user.rol)) {
        reply.code(403).send({ error: 'Acceso denegado' })
      }
    }
  })

  // Verifica permiso — uso: { preHandler: [app.authenticate, app.requierePermiso('clientes.ver')] }
  // El rol sale del JWT verificado, nunca del body. Los permisos de cada rol
  // están cacheados en memoria (ver services/permisos.js).
  app.decorate('requierePermiso', function(clave) {
    return async function(req, reply) {
      const tiene = await rolTienePermiso(req.user.rol, clave)
      if (!tiene) {
        reply.code(403).send({ error: `Falta el permiso ${clave}` })
      }
    }
  })
}