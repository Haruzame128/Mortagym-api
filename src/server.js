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
import accesoRoutes        from './routes/acceso.js'
import clientesExportRoutes from './routes/clientes_export.js'
import perfilRoutes from './routes/perfil.js'
import medicoRoutes from './routes/medico.js'
import nutricionRoutes from './routes/nutricion.js'
import initSueldos from '../scripts/init_sueldos.js'
import profesorRoutes from './routes/profesor.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = Fastify({ logger: true })

// CORS
await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-agent-key'],
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

// Inicializar sistema de sueldos (crear tablas si no existen)
try {
  await initSueldos()
} catch (err) {
  console.warn('⚠️  Advertencia al inicializar sueldos:', err.message)
}

// Rutas
app.register(authRoutes,      { prefix: '/api/auth' })
app.register(adminRoutes,     { prefix: '/api/admin' })
app.register(reservasRoutes,  { prefix: '/api/reservas' })
app.register(serviciosRoutes, { prefix: '/api/servicios' })
app.register(horariosRoutes,  { prefix: '/api/horarios' })
app.register(accesoRoutes,    { prefix: '/api/acceso' })
app.register(clientesExportRoutes, { prefix: '/api/clientes' })
app.register(perfilRoutes, { prefix: '/api/perfil' })
app.register(profesorRoutes, { prefix: '/api/profesor' })
app.register(medicoRoutes, { prefix: '/api/medico' })
app.register(nutricionRoutes, { prefix: '/api/nutricion' })

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