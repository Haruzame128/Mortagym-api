import { query } from '../../config/database.js'

export default async function movimientosRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador', 'Recepcion')] }

  // GET /api/admin/movimientos — Listar todos los movimientos
  app.get('/', admin, async (req, reply) => {
    try {
      const { tipo, fecha_desde, fecha_hasta, categoria } = req.query
      let sql = `
        SELECT m.id_movimiento, m.tipo_m, m.monto_m, m.descripcion_m,
               m.medio_pago_m, m.fecha_m, m.origen_m, m.anulado_m,
               m.creado_en, m.id_usuario,
               cm.nombre_cm AS categoria,
               COALESCE(c.nomap_c, prof.nomap_p, u.nombre_u, 'Sistema') AS usuario_nombre,
               u.dni_u
        FROM movimientos m
        JOIN categorias_movimiento cm ON cm.id_categoria = m.id_categoria
        LEFT JOIN clientes c ON c.id_cliente = (
          SELECT id_cliente FROM inscripcion WHERE id_inscripto = m.id_inscripto LIMIT 1
        )
        LEFT JOIN usuarios u ON u.id_usuario = m.id_usuario
        LEFT JOIN profesores prof ON prof.id_usuario = u.id_usuario
        WHERE m.anulado_m = false
      `
      const params = []

      // Recepción solo ve lo que cargó ella misma; Administrador ve todo.
      if (req.user.rol === 'Recepcion') {
        sql += ` AND m.id_usuario = $${params.length + 1}`
        params.push(req.user.id)
      }

      if (tipo) {
        sql += ` AND m.tipo_m = $${params.length + 1}`
        params.push(tipo)
      }

      if (categoria) {
        sql += ` AND cm.nombre_cm = $${params.length + 1}`
        params.push(categoria)
      }

      if (fecha_desde) {
        sql += ` AND m.fecha_m >= $${params.length + 1}`
        params.push(fecha_desde)
      }

      if (fecha_hasta) {
        sql += ` AND m.fecha_m <= $${params.length + 1}`
        params.push(fecha_hasta)
      }

      sql += ` ORDER BY m.fecha_m DESC, m.creado_en DESC`

      const { rows } = await query(sql, params)
      return rows
    } catch (err) {
      reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/admin/movimientos/resumen — Resumen de ingresos/egresos
  app.get('/resumen', admin, async (req, reply) => {
    try {
      const { fecha_desde, fecha_hasta } = req.query
      let sql = `
        SELECT
          m.tipo_m,
          cm.nombre_cm AS categoria,
          SUM(m.monto_m) AS total,
          COUNT(*) AS cantidad
        FROM movimientos m
        JOIN categorias_movimiento cm ON cm.id_categoria = m.id_categoria
        WHERE m.anulado_m = false
      `
      const params = []

      if (fecha_desde) {
        sql += ` AND m.fecha_m >= $${params.length + 1}`
        params.push(fecha_desde)
      }

      if (fecha_hasta) {
        sql += ` AND m.fecha_m <= $${params.length + 1}`
        params.push(fecha_hasta)
      }

      sql += ` GROUP BY m.tipo_m, cm.nombre_cm ORDER BY m.tipo_m, cm.nombre_cm`

      const { rows } = await query(sql, params)

      const ingresos = rows
        .filter(r => r.tipo_m === 'Ingreso')
        .reduce((sum, r) => sum + parseFloat(r.total || 0), 0)

      const egresos = rows
        .filter(r => r.tipo_m === 'Egreso')
        .reduce((sum, r) => sum + parseFloat(r.total || 0), 0)

      return {
        ingresos,
        egresos,
        balance: ingresos - egresos,
        detalles: rows
      }
    } catch (err) {
      reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/admin/movimientos/balance-mensual — Balance por mes
  app.get('/balance-mensual', admin, async (req, reply) => {
    try {
      const { rows } = await query(`
        SELECT
          to_char(m.fecha_m, 'Mon') AS mes,
          EXTRACT(MONTH FROM m.fecha_m) AS mes_num,
          EXTRACT(YEAR FROM m.fecha_m) AS año,
          m.tipo_m,
          SUM(m.monto_m) AS total
        FROM movimientos m
        WHERE m.anulado_m = false
        GROUP BY EXTRACT(YEAR FROM m.fecha_m), EXTRACT(MONTH FROM m.fecha_m),
                 to_char(m.fecha_m, 'Mon'), m.tipo_m
        ORDER BY año DESC, mes_num DESC
      `)

      const balances = {}
      rows.forEach(row => {
        const key = `${row.mes} ${row.año}`
        if (!balances[key]) {
          balances[key] = { mes: row.mes, ingresos: 0, egresos: 0 }
        }
        if (row.tipo_m === 'Ingreso') {
          balances[key].ingresos += parseFloat(row.total)
        } else {
          balances[key].egresos += parseFloat(row.total)
        }
      })

      return Object.values(balances)
    } catch (err) {
      reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/admin/movimientos/categorias — Listar categorías
  app.get('/categorias', admin, async (req, reply) => {
    try {
      const { rows } = await query(`
        SELECT id_categoria, nombre_cm, tipo_cm, activo_cm
        FROM categorias_movimiento
        ORDER BY tipo_cm, nombre_cm
      `)
      return rows
    } catch (err) {
      reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/admin/movimientos — Crear movimiento
  app.post('/', admin, async (req, reply) => {
    try {
      const { id_categoria, tipo_m, monto_m, descripcion_m, medio_pago_m, fecha_m } = req.body

      // Validar campos requeridos
      if (!id_categoria || !tipo_m || !monto_m) {
        return reply.code(400).send({ error: 'Faltan campos requeridos' })
      }

      if (monto_m <= 0) {
        return reply.code(400).send({ error: 'El monto debe ser mayor a 0' })
      }

      const { rows: [movimiento] } = await query(`
        INSERT INTO movimientos (
          id_categoria, id_usuario, tipo_m, monto_m, descripcion_m,
          medio_pago_m, fecha_m, origen_m
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'Manual')
        RETURNING id_movimiento, id_categoria, tipo_m, monto_m, descripcion_m,
                  medio_pago_m, fecha_m, creado_en
      `, [
        id_categoria,
        req.user.id,
        tipo_m,
        monto_m,
        descripcion_m || null,
        medio_pago_m || 'Efectivo',
        fecha_m || new Date().toISOString().split('T')[0]
      ])

      return reply.code(201).send(movimiento)
    } catch (err) {
      reply.code(500).send({ error: err.message })
    }
  })

  // PUT /api/admin/movimientos/:id — Actualizar movimiento
  app.put('/:id', admin, async (req, reply) => {
    try {
      const { id } = req.params
      const { id_categoria, tipo_m, monto_m, descripcion_m, medio_pago_m } = req.body

      if (monto_m && monto_m <= 0) {
        return reply.code(400).send({ error: 'El monto debe ser mayor a 0' })
      }

      const updates = []
      const params = [id]
      let paramIndex = 2

      if (id_categoria !== undefined) {
        updates.push(`id_categoria = $${paramIndex}`)
        params.push(id_categoria)
        paramIndex++
      }

      if (tipo_m !== undefined) {
        updates.push(`tipo_m = $${paramIndex}`)
        params.push(tipo_m)
        paramIndex++
      }

      if (monto_m !== undefined) {
        updates.push(`monto_m = $${paramIndex}`)
        params.push(monto_m)
        paramIndex++
      }

      if (descripcion_m !== undefined) {
        updates.push(`descripcion_m = $${paramIndex}`)
        params.push(descripcion_m || null)
        paramIndex++
      }

      if (medio_pago_m !== undefined) {
        updates.push(`medio_pago_m = $${paramIndex}`)
        params.push(medio_pago_m)
        paramIndex++
      }

      if (updates.length === 0) {
        return reply.code(400).send({ error: 'No hay campos para actualizar' })
      }

      const { rows } = await query(`
        UPDATE movimientos
        SET ${updates.join(', ')}
        WHERE id_movimiento = $1 AND anulado_m = false
        RETURNING id_movimiento, id_categoria, tipo_m, monto_m, descripcion_m,
                  medio_pago_m, fecha_m
      `, params)

      if (!rows[0]) {
        return reply.code(404).send({ error: 'Movimiento no encontrado' })
      }

      return rows[0]
    } catch (err) {
      reply.code(500).send({ error: err.message })
    }
  })

  // DELETE /api/admin/movimientos/:id — Anular movimiento (soft delete)
  app.delete('/:id', admin, async (req, reply) => {
    try {
      const { id } = req.params

      const { rows } = await query(`
        UPDATE movimientos
        SET anulado_m = true
        WHERE id_movimiento = $1 AND anulado_m = false
        RETURNING id_movimiento
      `, [id])

      if (!rows[0]) {
        return reply.code(404).send({ error: 'Movimiento no encontrado' })
      }

      return { mensaje: 'Movimiento anulado correctamente' }
    } catch (err) {
      reply.code(500).send({ error: err.message })
    }
  })
}
