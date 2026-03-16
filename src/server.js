import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

import { registerAuthHooks } from './hooks/autenticacion.js'
import authRoutes          from './routes/auth.js'
import adminRoutes         from './routes/admin/index.js'
import reservasRoutes      from './routes/reservas.js'
import serviciosRoutes     from './routes/servicios.js'
import horariosRoutes      from './routes/horarios.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = Fastify({ logger: true })

// CORS
await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
})

// Multipart (subida de archivos)
await app.register(fastifyMultipart, {
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB máximo
})

// Archivos estáticos — sirve la carpeta uploads/ en /uploads
await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'uploads'),
  prefix: '/uploads/',
})

// JWT
await app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET,
  sign: { expiresIn: '8h' },
})

// Auth hooks
registerAuthHooks(app)

// Rutas
app.register(authRoutes,      { prefix: '/api/auth' })
app.register(adminRoutes,     { prefix: '/api/admin' })
app.register(reservasRoutes,  { prefix: '/api/reservas' })
app.register(serviciosRoutes, { prefix: '/api/servicios' })
app.register(horariosRoutes,  { prefix: '/api/horarios' })

// Health check
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