
import { query, pool } from '../config/database.js'
import { createWriteStream, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '..', '..', 'uploads', 'servicios')

mkdirSync(UPLOADS_DIR, { recursive: true })

export default async function serviciosRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }

  // GET /api/servicios — público, lo usa el Home
  app.get('/', async () => {
    const { rows } = await query(`
      SELECT id_servicio, nombre_s, descripcion_s, extra_s, redes_s, imagen_s
      FROM servicios
      WHERE activo_s = true
      ORDER BY id_servicio
    `)
    return rows
  })

  // GET /api/servicios/admin — todos (activos e inactivos) para el panel admin
  app.get('/admin', admin, async () => {
    const { rows } = await query(`
      SELECT id_servicio, nombre_s, descripcion_s, extra_s, redes_s, imagen_s, activo_s
      FROM servicios
      ORDER BY id_servicio
    `)
    return rows
  })

  // POST /api/servicios
  app.post('/', {
    preHandler: [app.authenticate, app.authorize('Administrador')]
  }, async (req, reply) => {
    const parts = req.parts()
    let nombre = '', descripcion = '', extra = '', redes = ''
    let imagen_s = null

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'imagen') {
        const ext = part.filename.split('.').pop()
        const filename = `${randomUUID()}.${ext}`
        await pipeline(part.file, createWriteStream(join(UPLOADS_DIR, filename)))
        imagen_s = `/uploads/servicios/${filename}`
      } else {
        const val = part.value
        if (part.fieldname === 'nombre')      nombre      = val
        if (part.fieldname === 'descripcion') descripcion = val
        if (part.fieldname === 'extra')       extra       = val
        if (part.fieldname === 'redes')       redes       = val
      }
    }

    if (!nombre) return reply.code(400).send({ error: 'El nombre es obligatorio' })

    const { rows: [s] } = await query(
      `INSERT INTO servicios (nombre_s, descripcion_s, extra_s, redes_s, imagen_s, activo_s)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
      [nombre, descripcion, extra || null, redes || null, imagen_s]
    )
    return reply.code(201).send(s)
  })

  // PUT /api/servicios/:id
  app.put('/:id', {
    preHandler: [app.authenticate, app.authorize('Administrador')]
  }, async (req, reply) => {
    const parts = req.parts()
    let nombre, descripcion, extra, redes, activo
    let imagen_s = undefined

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'imagen') {
        const ext = part.filename.split('.').pop()
        const filename = `${randomUUID()}.${ext}`
        await pipeline(part.file, createWriteStream(join(UPLOADS_DIR, filename)))
        imagen_s = `/uploads/servicios/${filename}`
      } else {
        const val = part.value
        if (part.fieldname === 'nombre')      nombre      = val
        if (part.fieldname === 'descripcion') descripcion = val
        if (part.fieldname === 'extra')       extra       = val
        if (part.fieldname === 'redes')       redes       = val
        if (part.fieldname === 'activo')      activo      = val === 'true'
      }
    }

    const { rows: [s] } = await query(
      `UPDATE servicios SET
        nombre_s      = COALESCE($1, nombre_s),
        descripcion_s = COALESCE($2, descripcion_s),
        extra_s       = COALESCE($3, extra_s),
        redes_s       = COALESCE($4, redes_s),
        imagen_s      = COALESCE($5, imagen_s),
        activo_s      = COALESCE($6, activo_s)
       WHERE id_servicio = $7 RETURNING *`,
      [nombre, descripcion, extra, redes, imagen_s, activo, req.params.id]
    )
    if (!s) return reply.code(404).send({ error: 'Servicio no encontrado' })
    return s
  })
}