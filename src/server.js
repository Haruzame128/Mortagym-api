import Fastify from 'fastify'
import 'dotenv/config'

import corsPlugin            from './plugins/cors.js'
import jwtPlugin             from './plugins/jwt.js'
import { registerAuthHooks } from './hooks/autenticacion.js'

import authRoutes    from './routes/auth.js'
import adminRoutes   from './routes/admin/index.js'
import reservasRoutes from './routes/reservas.js'

const app = Fastify({ logger: true })

await app.register(corsPlugin)
await app.register(jwtPlugin)
registerAuthHooks(app)

app.register(authRoutes,     { prefix: '/api/auth' })
app.register(adminRoutes,    { prefix: '/api/admin' })
app.register(reservasRoutes, { prefix: '/api/reservas' })

app.get('/health', () => ({ status: 'ok', app: 'MortaGym API' }))

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'

try {
  await app.listen({ port: PORT, host: HOST })
  console.log(`🚀 MortaGym API corriendo en http://${HOST}:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}