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
}