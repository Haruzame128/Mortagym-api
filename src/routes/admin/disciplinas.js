
import { query, pool } from '../../config/database.js'
import { createWriteStream, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR      = join(__dirname, '..', '..', '..', 'uploads', 'disciplinas')
const UPLOADS_IMG_DIR  = join(__dirname, '..', '..', '..', 'uploads', 'disciplinas_imagenes')

mkdirSync(UPLOADS_DIR,     { recursive: true })
mkdirSync(UPLOADS_IMG_DIR, { recursive: true })

export default async function disciplinasRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }

  // ── GET /api/admin/disciplinas — panel admin ─────────────────────
  app.get('/', admin, async () => {
    const { rows } = await query(`
      SELECT d.id_disciplina, d.nombre_d, d.descripcion_d, d.activo_d, d.imagen_d,
             p.id_precio, p.precio_1, p.precio_2, p.precio_3,
             p.precio_4, p.precio_5, p.precio_6, p.precio_dia,
             p.precio_1_debito, p.precio_2_debito, p.precio_3_debito,
             p.precio_4_debito, p.precio_5_debito, p.precio_6_debito,
             p.precio_dia_debito
      FROM disciplinas d
      JOIN precios p ON p.id_precio = d.id_precio
      ORDER BY d.nombre_d
    `)
    return rows
  })

  // ── GET /api/admin/disciplinas/publico — página Actividades ──────
  // Devuelve disciplinas activas con actividades, imágenes y precios
  app.get('/publico', async () => {
    // Disciplinas activas con precios
    const { rows: disciplinas } = await query(`
      SELECT d.id_disciplina, d.nombre_d, d.descripcion_d, d.imagen_d,
             p.precio_1, p.precio_2, p.precio_3,
             p.precio_4, p.precio_5, p.precio_6, p.precio_dia,
             p.precio_1_debito, p.precio_2_debito, p.precio_3_debito,
             p.precio_4_debito, p.precio_5_debito, p.precio_6_debito,
             p.precio_dia_debito
      FROM disciplinas d
      JOIN precios p ON p.id_precio = d.id_precio
      WHERE d.activo_d = true
      ORDER BY d.nombre_d
    `)

    // Actividades por disciplina con sus precios
    const { rows: actividades } = await query(`
      SELECT a.id_actividad, a.id_disciplina, a.nombre_a, a.descripcion_a,
             p.precio_1, p.precio_2, p.precio_3, p.precio_4, p.precio_5, p.precio_6,
             p.precio_1_debito, p.precio_2_debito, p.precio_3_debito,
             p.precio_4_debito, p.precio_5_debito, p.precio_6_debito,
             p.precio_1_profesor, p.precio_2_profesor, p.precio_3_profesor,
             p.precio_4_profesor, p.precio_5_profesor, p.precio_6_profesor,
             p.precio_dia, p.precio_dia_debito
      FROM actividades a
      LEFT JOIN precios p ON p.id_precio = a.id_precio
      ORDER BY a.nombre_a
    `)

    // Imágenes por disciplina
    const { rows: imagenes } = await query(`
      SELECT id_imagen, id_disciplina, imagen, orden
      FROM disciplinas_imagenes
      ORDER BY id_disciplina, orden
    `)

    // Armar respuesta combinada
    const resultado = disciplinas.map(d => ({
      ...d,
      actividades: actividades.filter(a => a.id_disciplina === d.id_disciplina),
      imagenes:    imagenes.filter(i => i.id_disciplina === d.id_disciplina),
    }))

    return resultado
  })

  // ── POST /api/admin/disciplinas ──────────────────────────────────
  app.post('/', {
    preHandler: [app.authenticate, app.authorize('Administrador')]
  }, async (req, reply) => {
    const parts = req.parts()
    let nombre = '', descripcion = '', precios = {}
    let imagen_d = null

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'imagen') {
        const ext = part.filename.split('.').pop()
        const filename = `${randomUUID()}.${ext}`
        await pipeline(part.file, createWriteStream(join(UPLOADS_DIR, filename)))
        imagen_d = `/uploads/disciplinas/${filename}`
      } else {
        const val = part.value
        if (part.fieldname === 'nombre')      nombre      = val
        if (part.fieldname === 'descripcion') descripcion = val
        if (part.fieldname === 'precios')     precios     = JSON.parse(val)
      }
    }

    if (!nombre) return reply.code(400).send({ error: 'El nombre es obligatorio' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: [precio] } = await client.query(
        `INSERT INTO precios (precio_1, precio_2, precio_3, precio_4, precio_5, precio_6, precio_dia,
                              precio_1_debito, precio_2_debito, precio_3_debito, precio_4_debito,
                              precio_5_debito, precio_6_debito, precio_dia_debito)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id_precio`,
        [
          precios.precio_1        || 0, precios.precio_2        || 0, precios.precio_3        || 0,
          precios.precio_4        || 0, precios.precio_5        || 0, precios.precio_6        || 0,
          precios.precio_dia      || 0,
          precios.precio_1_debito || 0, precios.precio_2_debito || 0, precios.precio_3_debito || 0,
          precios.precio_4_debito || 0, precios.precio_5_debito || 0, precios.precio_6_debito || 0,
          precios.precio_dia_debito || 0,
        ]
      )

      const { rows: [disc] } = await client.query(
        `INSERT INTO disciplinas (nombre_d, descripcion_d, imagen_d, activo_d, id_precio)
         VALUES ($1, $2, $3, true, $4) RETURNING id_disciplina`,
        [nombre, descripcion, imagen_d, precio.id_precio]
      )

      await client.query('COMMIT')
      return reply.code(201).send({ id_disciplina: disc.id_disciplina, nombre, imagen_d })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // ── PUT /api/admin/disciplinas/:id/precios ───────────────────────
  app.put('/:id/precios', admin, async (req, reply) => {
    const { precios } = req.body
    if (!precios) return reply.code(400).send({ error: 'Precios requeridos' })

    const { rows: [disc] } = await query(
      `SELECT id_precio FROM disciplinas WHERE id_disciplina = $1`, [req.params.id]
    )
    if (!disc) return reply.code(404).send({ error: 'Disciplina no encontrada' })

    await query(
      `UPDATE precios SET
        precio_1   = COALESCE($1,  precio_1),   precio_2   = COALESCE($2,  precio_2),
        precio_3   = COALESCE($3,  precio_3),   precio_4   = COALESCE($4,  precio_4),
        precio_5   = COALESCE($5,  precio_5),   precio_6   = COALESCE($6,  precio_6),
        precio_dia = COALESCE($7,  precio_dia),
        precio_1_debito   = COALESCE($8,  precio_1_debito),
        precio_2_debito   = COALESCE($9,  precio_2_debito),
        precio_3_debito   = COALESCE($10, precio_3_debito),
        precio_4_debito   = COALESCE($11, precio_4_debito),
        precio_5_debito   = COALESCE($12, precio_5_debito),
        precio_6_debito   = COALESCE($13, precio_6_debito),
        precio_dia_debito = COALESCE($14, precio_dia_debito)
       WHERE id_precio = $15`,
      [
        precios.precio_1, precios.precio_2, precios.precio_3,
        precios.precio_4, precios.precio_5, precios.precio_6, precios.precio_dia,
        precios.precio_1_debito, precios.precio_2_debito, precios.precio_3_debito,
        precios.precio_4_debito, precios.precio_5_debito, precios.precio_6_debito,
        precios.precio_dia_debito, disc.id_precio,
      ]
    )
    return { message: 'Precios actualizados' }
  })

  // ── PUT /api/admin/disciplinas/:id/activo ────────────────────────
  app.put('/:id/activo', admin, async (req, reply) => {
    const { activo } = req.body
    if (activo === undefined) return reply.code(400).send({ error: 'activo es requerido' })

    const { rows: [disc] } = await query(
      `UPDATE disciplinas SET activo_d = $1 WHERE id_disciplina = $2 RETURNING activo_d`,
      [activo, req.params.id]
    )
    if (!disc) return reply.code(404).send({ error: 'Disciplina no encontrada' })
    return { activo_d: disc.activo_d }
  })

  // ── PUT /api/admin/disciplinas/:id ───────────────────────────────
  app.put('/:id', {
    preHandler: [app.authenticate, app.authorize('Administrador')]
  }, async (req, reply) => {
    const parts = req.parts()
    let nombre, descripcion, activo, precios
    let imagen_d = undefined

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'imagen') {
        const ext = part.filename.split('.').pop()
        const filename = `${randomUUID()}.${ext}`
        await pipeline(part.file, createWriteStream(join(UPLOADS_DIR, filename)))
        imagen_d = `/uploads/disciplinas/${filename}`
      } else {
        const val = part.value
        if (part.fieldname === 'nombre')      nombre      = val
        if (part.fieldname === 'descripcion') descripcion = val
        if (part.fieldname === 'activo')      activo      = val === 'true'
        if (part.fieldname === 'precios')     precios     = JSON.parse(val)
      }
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: [disc] } = await client.query(
        `UPDATE disciplinas SET
          nombre_d      = COALESCE($1, nombre_d),
          descripcion_d = COALESCE($2, descripcion_d),
          imagen_d      = COALESCE($3, imagen_d),
          activo_d      = COALESCE($4, activo_d)
         WHERE id_disciplina = $5 RETURNING id_precio`,
        [nombre, descripcion, imagen_d, activo, req.params.id]
      )
      if (!disc) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Disciplina no encontrada' })
      }

      if (precios) {
        await client.query(
          `UPDATE precios SET
            precio_1   = COALESCE($1,  precio_1),   precio_2   = COALESCE($2,  precio_2),
            precio_3   = COALESCE($3,  precio_3),   precio_4   = COALESCE($4,  precio_4),
            precio_5   = COALESCE($5,  precio_5),   precio_6   = COALESCE($6,  precio_6),
            precio_dia = COALESCE($7,  precio_dia),
            precio_1_debito   = COALESCE($8,  precio_1_debito),
            precio_2_debito   = COALESCE($9,  precio_2_debito),
            precio_3_debito   = COALESCE($10, precio_3_debito),
            precio_4_debito   = COALESCE($11, precio_4_debito),
            precio_5_debito   = COALESCE($12, precio_5_debito),
            precio_6_debito   = COALESCE($13, precio_6_debito),
            precio_dia_debito = COALESCE($14, precio_dia_debito)
           WHERE id_precio = $15`,
          [
            precios.precio_1, precios.precio_2, precios.precio_3,
            precios.precio_4, precios.precio_5, precios.precio_6, precios.precio_dia,
            precios.precio_1_debito, precios.precio_2_debito, precios.precio_3_debito,
            precios.precio_4_debito, precios.precio_5_debito, precios.precio_6_debito,
            precios.precio_dia_debito, disc.id_precio,
          ]
        )
      }

      await client.query('COMMIT')
      return { message: 'Disciplina actualizada' }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // ── GET /api/admin/disciplinas/:id/imagenes ─────────────────────
  app.get('/:id/imagenes', admin, async (req) => {
    const { rows } = await query(
      `SELECT id_imagen, imagen, orden FROM disciplinas_imagenes
       WHERE id_disciplina = $1 ORDER BY orden`,
      [req.params.id]
    )
    return rows
  })

  // ── POST /api/admin/disciplinas/:id/imagenes ─────────────────────
  app.post('/:id/imagenes', {
    preHandler: [app.authenticate, app.authorize('Administrador')]
  }, async (req, reply) => {
    const parts = req.parts()
    let orden = 0
    let imagen = null

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'imagen') {
        const ext = part.filename.split('.').pop()
        const filename = `${randomUUID()}.${ext}`
        await pipeline(part.file, createWriteStream(join(UPLOADS_IMG_DIR, filename)))
        imagen = `/uploads/disciplinas_imagenes/${filename}`
      } else {
        if (part.fieldname === 'orden') orden = parseInt(part.value) || 0
      }
    }

    if (!imagen) return reply.code(400).send({ error: 'Imagen requerida' })

    const { rows: [img] } = await query(
      `INSERT INTO disciplinas_imagenes (id_disciplina, imagen, orden)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, imagen, orden]
    )
    return reply.code(201).send(img)
  })

  // ── DELETE /api/admin/disciplinas/:id/imagenes/:imgId ────────────
  app.delete('/:id/imagenes/:imgId', admin, async (req, reply) => {
    const { rows: [img] } = await query(
      `DELETE FROM disciplinas_imagenes WHERE id_imagen = $1 AND id_disciplina = $2 RETURNING *`,
      [req.params.imgId, req.params.id]
    )
    if (!img) return reply.code(404).send({ error: 'Imagen no encontrada' })
    return { message: 'Imagen eliminada' }
  })
}