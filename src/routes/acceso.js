import { query } from '../config/database.js'

export default async function accesoRoutes(app) {

  // POST /api/acceso/verificar
  // Recibe { dni } — sin autenticación, lo llama el agente local
  // Devuelve si el cliente puede ingresar y por qué
  app.post('/verificar', async (req, reply) => {
    const { dni } = req.body
    if (!dni) return reply.code(400).send({ error: 'Falta el campo dni' })

    // 1 — Buscar usuario + cliente
    const { rows: [cliente] } = await query(`
      SELECT c.id_cliente, c.nomap_c, c.activo_c, c.venc_ficha_medica,
             u.dni_u, u.activo_u
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE u.dni_u = $1
    `, [String(dni)])

    if (!cliente) {
      return reply.send({
        permitido: false,
        motivo: 'no_encontrado',
        mensaje: 'El cliente no existe en el sistema',
        cliente: null,
      })
    }

    if (!cliente.activo_u || !cliente.activo_c) {
      return reply.send({
        permitido: false,
        motivo: 'inactivo',
        mensaje: 'La cuenta del cliente está desactivada',
        cliente: { nombre: cliente.nomap_c, dni: cliente.dni_u },
      })
    }

    // 2 — Buscar suscripciones activas
    // Una suscripción es válida si:
    //   pago_s = true
    //   entradas_restantes > 0
    //   fecha_s está dentro del mes y año actuales
    const { rows: suscripciones } = await query(`
      SELECT s.id_suscripcion, s.pago_s, s.entradas_restantes, s.entradas_totales,
             s.fecha_s, s.cantidad_dias,
             a.nombre_a, d.nombre_d
      FROM suscripciones s
      JOIN inscripcion i    ON i.id_inscripto   = s.id_inscripto
      JOIN actividades a    ON a.id_actividad   = i.id_actividad
      JOIN disciplinas d    ON d.id_disciplina  = a.id_disciplina
      WHERE i.id_cliente = $1
        AND s.pago_s = true
        AND s.entradas_restantes > 0
        AND EXTRACT(MONTH FROM s.fecha_s) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR  FROM s.fecha_s) = EXTRACT(YEAR  FROM CURRENT_DATE)
      ORDER BY s.fecha_s DESC
    `, [cliente.id_cliente])

    if (suscripciones.length === 0) {
      // Buscar si tiene suscripciones pero sin entradas / sin pago para dar motivo específico
      const { rows: [cualquiera] } = await query(`
        SELECT s.pago_s, s.entradas_restantes, s.fecha_s
        FROM suscripciones s
        JOIN inscripcion i ON i.id_inscripto = s.id_inscripto
        WHERE i.id_cliente = $1
        ORDER BY s.fecha_s DESC
        LIMIT 1
      `, [cliente.id_cliente])

      let motivo = 'sin_suscripcion'
      let mensaje = 'No tiene ninguna suscripción registrada'

      if (cualquiera) {
        const mismoMes =
          new Date(cualquiera.fecha_s).getMonth() === new Date().getMonth() &&
          new Date(cualquiera.fecha_s).getFullYear() === new Date().getFullYear()

        if (!mismoMes) {
          motivo = 'vencida'
          mensaje = 'La suscripción del mes anterior no fue renovada'
        } else if (!cualquiera.pago_s) {
          motivo = 'sin_pago'
          mensaje = 'La suscripción no está paga'
        } else if (cualquiera.entradas_restantes <= 0) {
          motivo = 'sin_entradas'
          mensaje = 'No le quedan entradas disponibles este mes'
        }
      }

      return reply.send({
        permitido: false,
        motivo,
        mensaje,
        cliente: { nombre: cliente.nomap_c, dni: cliente.dni_u },
      })
    }

    // 3 — Acceso permitido: descontar 1 entrada de la primer suscripción válida
    const suscActiva = suscripciones[0]
    await query(`
      UPDATE suscripciones
      SET entradas_restantes = entradas_restantes - 1
      WHERE id_suscripcion = $1
    `, [suscActiva.id_suscripcion])

    return reply.send({
      permitido: true,
      motivo: 'ok',
      mensaje: 'Acceso autorizado',
      cliente: {
        nombre:       cliente.nomap_c,
        dni:          cliente.dni_u,
        actividades:  suscripciones.map(s => s.nombre_d + ' — ' + s.nombre_a),
        entradas_restantes: suscActiva.entradas_restantes - 1, // post-descuento
        entradas_totales:   suscActiva.entradas_totales,
      },
    })
  })


  // POST /api/acceso/registrar-entrada  (sin descuento — para registrar sin validar)
  // Útil para recepción manual, si en el futuro se necesita
  app.post('/registrar-entrada', {
    preHandler: [app.authenticate, app.authorize('Administrador', 'Recepcion')],
  }, async (req, reply) => {
    const { id_suscripcion } = req.body
    if (!id_suscripcion) return reply.code(400).send({ error: 'Falta id_suscripcion' })

    const { rows: [updated] } = await query(`
      UPDATE suscripciones
      SET entradas_restantes = GREATEST(entradas_restantes - 1, 0)
      WHERE id_suscripcion = $1
      RETURNING id_suscripcion, entradas_restantes
    `, [id_suscripcion])

    if (!updated) return reply.code(404).send({ error: 'Suscripción no encontrada' })
    return updated
  })
}
