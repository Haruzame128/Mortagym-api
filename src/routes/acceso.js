import { query } from '../config/database.js'

// Lo llama el agente local de huellas (huella-agent-electron) después de
// identificar la huella y resolverla a un DNI — no hay ningún usuario
// logueado en la puerta, así que en vez de JWT se protege con la misma
// clave compartida que protege /api/clientes/exportar-huellas. Si no se
// configuró ninguna clave, no se exige (para no romper el desarrollo local).
const verificarClaveAgente = (req, reply, done) => {
  const clave = process.env.AGENT_API_KEY
  if (!clave) return done()
  if (req.headers['x-agent-key'] !== clave) {
    return reply.code(401).send({ error: 'Clave de agente inválida' })
  }
  done()
}

export default async function accesoRoutes(app) {

  // POST /api/acceso/verificar
  // Recibe { dni } — lo llama el agente local ya resuelta la huella a un
  // DNI. Devuelve si el cliente puede ingresar y por qué, y descuenta 1
  // entrada si corresponde. Cada intento (autorizado o no) queda registrado
  // en asistencia_cliente para poder auditarlo.
  app.post('/verificar', { preHandler: verificarClaveAgente }, async (req, reply) => {
    const { dni } = req.body
    // Con qué se identificó esta vez — hoy siempre 'huella' (el ingreso por
    // PIN todavía requiere integrar el teclado del molinete), pero el campo
    // ya se acepta y se registra para cuando esté esa parte.
    const metodo = req.body.metodo === 'pin' ? 'pin' : 'huella'
    if (!dni) return reply.code(400).send({ error: 'Falta el campo dni' })

    const registrar = (resultado, id_cliente = null, id_suscripcion = null) =>
      query(`
        INSERT INTO asistencia_cliente (id_cliente, dni_ingresado, id_suscripcion, permitido, motivo, mensaje, metodo)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [id_cliente, String(dni), id_suscripcion, resultado.permitido, resultado.motivo, resultado.mensaje, metodo])

    // 1 — Buscar usuario + cliente
    const { rows: [cliente] } = await query(`
      SELECT c.id_cliente, c.nomap_c, c.activo_c, c.venc_ficha_medica,
             u.dni_u, u.activo_u
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE u.dni_u = $1
    `, [String(dni)])

    if (!cliente) {
      const resultado = {
        permitido: false,
        motivo: 'no_encontrado',
        mensaje: 'El cliente no existe en el sistema',
        cliente: null,
      }
      await registrar(resultado)
      return reply.send(resultado)
    }

    if (!cliente.activo_u || !cliente.activo_c) {
      const resultado = {
        permitido: false,
        motivo: 'inactivo',
        mensaje: 'La cuenta del cliente está desactivada',
        cliente: { nombre: cliente.nomap_c, dni: cliente.dni_u },
      }
      await registrar(resultado, cliente.id_cliente)
      return reply.send(resultado)
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

      const resultado = {
        permitido: false,
        motivo,
        mensaje,
        cliente: { nombre: cliente.nomap_c, dni: cliente.dni_u },
      }
      await registrar(resultado, cliente.id_cliente)
      return reply.send(resultado)
    }

    // 3 — Acceso permitido: descontar 1 entrada de la primer suscripción válida
    const suscActiva = suscripciones[0]
    await query(`
      UPDATE suscripciones
      SET entradas_restantes = entradas_restantes - 1
      WHERE id_suscripcion = $1
    `, [suscActiva.id_suscripcion])

    const resultado = {
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
    }
    await registrar(resultado, cliente.id_cliente, suscActiva.id_suscripcion)
    return reply.send(resultado)
  })


  // GET /api/acceso/historial/:id_cliente — últimos ingresos de un cliente
  app.get('/historial/:id_cliente', {
    preHandler: [app.authenticate, app.authorize('Administrador', 'Recepcion')],
  }, async (req) => {
    const { rows } = await query(`
      SELECT id_asistencia, fecha_hora, permitido, motivo, mensaje, metodo
      FROM asistencia_cliente
      WHERE id_cliente = $1
      ORDER BY fecha_hora DESC
      LIMIT 50
    `, [req.params.id_cliente])
    return rows
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
