import bcrypt from 'bcrypt'
import { query, pool } from '../../config/database.js'

export default async function clientesRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador', 'Recepcion')] }

  // Estado del apto médico físico (distinto de la ficha_medica digital de la
  // inscripción): vigente si venc_ficha_medica todavía no pasó; pendiente si
  // nunca se entregó pero todavía está dentro del mes de plazo desde el alta;
  // vencido en cualquier otro caso (entregado y vencido, o nunca entregado y
  // ya pasó el plazo).
  const ESTADO_APTO_MEDICO_SQL = `
    CASE
      WHEN c.venc_ficha_medica IS NOT NULL AND c.venc_ficha_medica >= CURRENT_DATE THEN 'vigente'
      WHEN c.venc_ficha_medica IS NOT NULL AND c.venc_ficha_medica < CURRENT_DATE THEN 'vencido'
      WHEN fecha_alta.fecha IS NULL OR fecha_alta.fecha + INTERVAL '1 month' >= CURRENT_DATE THEN 'pendiente'
      ELSE 'vencido'
    END AS estado_ficha_medica
  `

  // GET /api/admin/clientes
  app.get('/', admin, async () => {
    const { rows } = await query(`
      SELECT c.id_cliente, c.nomap_c, c.activo_c, c.venc_ficha_medica,
             c.fecha_entrega_ficha_medica, fecha_alta.fecha AS fecha_alta,
             c.fecha_baja, c.tipo_baja, c.motivo_baja,
             c.pin_acceso_c, u.dni_u,
             (SELECT COUNT(*) FROM huellas_cliente hc WHERE hc.id_cliente = c.id_cliente) AS cantidad_huellas,
             (SELECT STRING_AGG(DISTINCT d.nombre_d, ', ' ORDER BY d.nombre_d)
              FROM inscripcion i
              JOIN actividades a  ON a.id_actividad  = i.id_actividad
              JOIN disciplinas d  ON d.id_disciplina = a.id_disciplina
              WHERE i.id_cliente = c.id_cliente
             ) AS disciplinas,
             (SELECT EXISTS(
                SELECT 1 FROM inscripcion i
                JOIN suscripciones s ON s.id_inscripto = i.id_inscripto
                WHERE i.id_cliente = c.id_cliente AND s.pago_s = true
             )) AS cuota_al_dia,
             (SELECT EXISTS(
                SELECT 1 FROM ficha_medica fm WHERE fm.id_cliente = c.id_cliente
             )) AS tiene_ficha,
             ${ESTADO_APTO_MEDICO_SQL}
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      LEFT JOIN LATERAL (
        SELECT MIN(i.fecha_inscripcion) AS fecha
        FROM inscripcion i WHERE i.id_cliente = c.id_cliente
      ) fecha_alta ON true
      ORDER BY c.nomap_c
    `)
    return rows
  })

  // GET /api/admin/clientes/:id
  app.get('/:id', admin, async (req, reply) => {
    const { rows } = await query(`
      SELECT c.*, u.dni_u, u.rol_u, u.activo_u, fecha_alta.fecha AS fecha_alta,
             ${ESTADO_APTO_MEDICO_SQL}
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      LEFT JOIN LATERAL (
        SELECT MIN(i.fecha_inscripcion) AS fecha
        FROM inscripcion i WHERE i.id_cliente = c.id_cliente
      ) fecha_alta ON true
      WHERE c.id_cliente = $1
    `, [req.params.id])
    if (!rows[0]) return reply.code(404).send({ error: 'Cliente no encontrado' })

    // Estado actual de cada inscripción: la última suscripción (período) cargada.
    // Usamos LATERAL en vez de un LEFT JOIN plano porque cada renovación agrega
    // una fila nueva a suscripciones para el mismo id_inscripto.
    const { rows: inscripciones } = await query(`
      SELECT i.id_inscripto, i.id_actividad, i.id_horario, i.permiso_salida, i.permiso_fotos_redes,
             a.nombre_a, d.id_disciplina, d.nombre_d, i.fecha_inscripcion,
             h.dia_h, h.hora_h, p.nomap_p AS profesor,
             s.id_suscripcion, s.pago_s, s.tipo_pago_s, s.fecha_s,
             s.cantidad_dias, s.inasistencias_s,
             s.entradas_totales, s.entradas_restantes, s.con_profesor
      FROM inscripcion i
      JOIN actividades a ON a.id_actividad = i.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN horarios h   ON h.id_horario  = i.id_horario
      LEFT JOIN profesores p ON p.id_profesor = h.id_profesor
      LEFT JOIN LATERAL (
        SELECT * FROM suscripciones s2
        WHERE s2.id_inscripto = i.id_inscripto
        ORDER BY s2.fecha_s DESC, s2.id_suscripcion DESC
        LIMIT 1
      ) s ON true
      WHERE i.id_cliente = $1
      ORDER BY i.fecha_inscripcion DESC
    `, [req.params.id])

    // Historial completo: todos los períodos cobrados (o pendientes) por inscripción.
    const { rows: historial } = await query(`
      SELECT s.id_suscripcion, s.id_inscripto, s.fecha_s, s.pago_s,
             s.tipo_pago_s, s.cantidad_dias,
             a.nombre_a, d.nombre_d,
             m.monto_m, m.medio_pago_m, m.fecha_m AS fecha_pago
      FROM suscripciones s
      JOIN inscripcion i ON i.id_inscripto = s.id_inscripto
      JOIN actividades a ON a.id_actividad = i.id_actividad
      JOIN disciplinas  d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN movimientos m
        ON m.id_suscripcion = s.id_suscripcion
       AND m.tipo_m = 'Ingreso' AND m.anulado_m = false
      WHERE i.id_cliente = $1
      ORDER BY s.fecha_s DESC, s.id_suscripcion DESC
    `, [req.params.id])

    const { rows: [ficha] } = await query(
      `SELECT * FROM ficha_medica WHERE id_cliente = $1`,
      [req.params.id]
    )

    const { rows: huellas } = await query(
      `SELECT id_huella, etiqueta, creado_en FROM huellas_cliente WHERE id_cliente = $1 ORDER BY creado_en`,
      [req.params.id]
    )

    return { ...rows[0], inscripciones, historial, ficha_medica: ficha || null, huellas }
  })

  // GET /api/admin/clientes/:id/matriculas — historial de matrículas por año
  app.get('/:id/matriculas', admin, async (req) => {
    const { rows } = await query(`
      SELECT m.id_matricula, m.id_disciplina, d.nombre_d AS disciplina, m.anio,
             m.fecha_pago, m.monto, m.medio_pago
      FROM matriculas m
      JOIN disciplinas d ON d.id_disciplina = m.id_disciplina
      WHERE m.id_cliente = $1
      ORDER BY m.anio DESC, d.nombre_d
    `, [req.params.id])
    return rows
  })

  // ── Helper: crear reserva_musculacion si corresponde ──────────
  const crearReservaMusculacion = async (client, id_cliente, id_horario) => {
    if (!id_horario) return
    const { rows: [act] } = await client.query(
      `SELECT d.tipo_d FROM horarios h
       JOIN actividades a ON a.id_actividad = h.id_actividad
       JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
       WHERE h.id_horario = $1`,
      [id_horario]
    )
    if (act?.tipo_d === 'musculacion') {
      await client.query(
        `INSERT INTO reserva_musculacion (id_cliente, id_horario)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id_cliente, id_horario]
      )
    }
  }

  // ── Helper: precio de lista de una actividad segun cantidad_dias ──
  // con_profesor === true usa el recargo "con profesor" (precio_N_profesor,
  // hoy solo cargado para Natación) si está configurado; si no, cae al
  // precio base de siempre (que en la web pública se muestra como "Libre").
  const obtenerPrecioActividad = async (client, id_actividad, cantidad_dias, con_profesor) => {
    const { rows: [row] } = await client.query(
      `SELECT a.nombre_a, pr.precio_1, pr.precio_2, pr.precio_3,
              pr.precio_4, pr.precio_5, pr.precio_6, pr.precio_dia,
              pr.precio_1_profesor, pr.precio_2_profesor, pr.precio_3_profesor,
              pr.precio_4_profesor, pr.precio_5_profesor, pr.precio_6_profesor
       FROM actividades a
       JOIN disciplinas d  ON d.id_disciplina = a.id_disciplina
       JOIN precios     pr ON pr.id_precio    = COALESCE(a.id_precio, d.id_precio)
       WHERE a.id_actividad = $1`,
      [id_actividad]
    )
    if (!row) return { precio: 0, nombre_a: null }
    let precio
    if (con_profesor === true) {
      precio = Number(row[`precio_${cantidad_dias}_profesor`] || 0) || null
    }
    if (precio == null) {
      precio = row[`precio_${cantidad_dias}`] ?? row.precio_dia ?? 0
    }
    return { precio: Number(precio), nombre_a: row.nombre_a }
  }

  // ── Helper: medio_pago_m solo acepta 'Efectivo'|'Debito'|'Transferencia'|
  // 'Credito'|'Otro' (movimientos_medio_pago_m_check), pero el tipo_pago que
  // se elige al inscribir/renovar es uno de TIPOS_PAGO (minúsculas, y
  // 'tarjeta'/'mercadopago' no tienen un valor igual en la constraint).
  const MEDIO_PAGO_DB = {
    efectivo: 'Efectivo', transferencia: 'Transferencia',
    tarjeta: 'Debito', mercadopago: 'Otro',
  }
  const mapearMedioPago = (tipoPago) => MEDIO_PAGO_DB[tipoPago] || 'Efectivo'

  // ── Helper: registrar el cobro de una cuota como Ingreso ──────
  const registrarIngresoCuota = async (client, { id_usuario, id_suscripcion, id_inscripto, monto, medio_pago, descripcion }) => {
    if (!monto || monto <= 0) return

    let { rows: [categoria] } = await client.query(
      `SELECT id_categoria FROM categorias_movimiento WHERE nombre_cm = 'Cuota' AND tipo_cm = 'Ingreso'`
    )
    if (!categoria) {
      ({ rows: [categoria] } = await client.query(
        `INSERT INTO categorias_movimiento (nombre_cm, tipo_cm, activo_cm)
         VALUES ('Cuota', 'Ingreso', true) RETURNING id_categoria`
      ))
    }

    await client.query(
      `INSERT INTO movimientos (
         id_categoria, id_usuario, id_suscripcion, id_inscripto,
         tipo_m, monto_m, descripcion_m, medio_pago_m, origen_m
       ) VALUES ($1,$2,$3,$4,'Ingreso',$5,$6,$7,'Automatico')`,
      [categoria.id_categoria, id_usuario, id_suscripcion, id_inscripto,
       monto, descripcion || 'Cobro de cuota', medio_pago || 'Efectivo']
    )
  }

  // ── Helper: crear inscripcion + suscripcion + reserva ─────────
  const crearInscripcion = async (client, id_cliente, insc, id_usuario) => {
    const { rows: [inscripcion] } = await client.query(
      `INSERT INTO inscripcion
         (id_cliente, id_actividad, id_horario, fecha_inscripcion,
          permiso_salida, permiso_fotos_redes)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,$5)
       RETURNING id_inscripto`,
      [id_cliente, insc.id_actividad, insc.id_horario,
       insc.permiso_salida || false, insc.permiso_fotos_redes || false]
    )

    const cantidad_dias = insc.cantidad_dias || 1
    const entradas = cantidad_dias * 4

    const { rows: [suscripcion] } = await client.query(
      `INSERT INTO suscripciones
         (id_inscripto, pago_s, tipo_pago_s, fecha_s, cantidad_dias,
          inasistencias_s, entradas_totales, entradas_restantes, con_profesor)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,0,$5,$5,$6)
       RETURNING id_suscripcion`,
      [inscripcion.id_inscripto, insc.pago || false,
       insc.tipo_pago || 'efectivo', cantidad_dias, entradas,
       insc.con_profesor ?? null]
    )

    if (insc.pago) {
      const { precio, nombre_a } = await obtenerPrecioActividad(client, insc.id_actividad, cantidad_dias, insc.con_profesor)
      await registrarIngresoCuota(client, {
        id_usuario,
        id_suscripcion: suscripcion.id_suscripcion,
        id_inscripto: inscripcion.id_inscripto,
        monto: precio,
        medio_pago: mapearMedioPago(insc.tipo_pago),
        descripcion: `Cuota${nombre_a ? ' ' + nombre_a : ''} - alta`,
      })
    }

    if (insc.id_horario) {
      await client.query(
        `UPDATE horarios SET cupo_actual = cupo_actual + 1 WHERE id_horario = $1`,
        [insc.id_horario]
      )
      await crearReservaMusculacion(client, id_cliente, insc.id_horario)
    }
  }

  // POST /api/admin/clientes
  app.post('/', {
    ...admin,
    schema: {
      body: {
        type: 'object',
        required: ['dni', 'nombre_apellido'],
        properties: {
          dni:               { type: 'integer' },
          nombre_apellido:   { type: 'string' },
          contrasena:        { type: 'string' },
          direccion:         { type: 'string' },
          telefono:          { type: 'string' },
          tel_emergencia:    { type: 'string' },
          fecha_nac:         { type: 'string' },
          venc_ficha_medica: { type: 'string' },
          ficha_medica:      { type: 'object' },
          inscripciones:     { type: 'array' },
        }
      }
    }
  }, async (req, reply) => {
    const {
      dni, nombre_apellido, contrasena,
      direccion, telefono, tel_emergencia, fecha_nac,
      venc_ficha_medica,
      ficha_medica, inscripciones = []
    } = req.body

    const passwordPlano = contrasena || String(dni)
    const hash = await bcrypt.hash(passwordPlano, 10)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // 1 — Crear usuario
      const { rows: [usuario] } = await client.query(
        `INSERT INTO usuarios (dni_u, password_u, rol_u, activo_u)
         VALUES ($1, $2, 'Cliente', true) RETURNING id_usuario`,
        [dni, hash]
      )

      // 2 — Crear cliente
      const { rows: [nuevoCliente] } = await client.query(
        `INSERT INTO clientes
           (id_usuario, nomap_c, activo_c, venc_ficha_medica,
            direccion_c, telefono_c, tel_emergencia_c, fecha_nac_c)
         VALUES ($1,$2,true,$3,$4,$5,$6,$7)
         RETURNING id_cliente`,
        [usuario.id_usuario, nombre_apellido,
         venc_ficha_medica || null, direccion || null, telefono || null,
         tel_emergencia || null, fecha_nac || null]
      )

      const id_cliente = nuevoCliente.id_cliente

      // 3 — Crear ficha médica
      if (ficha_medica) {
        await client.query(
          `INSERT INTO ficha_medica (
            id_cliente, altura, peso, grupo_sanguineo,
            patologia_columna, patologia_columna_det,
            otras_patologias, otras_patologias_det,
            enf_cardiaca, enf_cardiaca_det, lesiones, lesiones_det,
            practica_deportes, practica_deportes_det,
            mareos, mareos_det, dolor_cabeza, dolor_cabeza_det,
            desmayos, desmayos_det, hemorragias_nasales, hemorragias_nasales_det,
            dolores_articulaciones, dolores_articulaciones_det,
            pie_plano, pie_plano_det, problemas_rodilla, problemas_rodilla_det,
            cirugias, cirugias_det, convulsiones, convulsiones_det,
            problemas_respiratorios, problemas_respiratorios_det,
            medicacion, medicacion_det, alergico, alergico_det
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                    $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
                    $29,$30,$31,$32,$33,$34,$35,$36,$37,$38)`,
          [
            id_cliente,
            ficha_medica.altura || null, ficha_medica.peso || null,
            ficha_medica.grupoSanguineo || null,
            ficha_medica.patologiaColumna || false,
            ficha_medica.patologiaColumnaDetalle || null,
            ficha_medica.otrasPatologias || false,
            ficha_medica.otrasPatologiasDetalle || null,
            ficha_medica.enfermedadCardiaca || false,
            ficha_medica.enfermedadCardiacaDetalle || null,
            ficha_medica.lesiones || false,
            ficha_medica.lesionesDetalle || null,
            ficha_medica.practicaDeportes || false,
            ficha_medica.practicaDeportesDetalle || null,
            ficha_medica.mareos || false,
            ficha_medica.mareosDetalle || null,
            ficha_medica.dolorCabeza || false,
            ficha_medica.dolorCabezaDetalle || null,
            ficha_medica.desmayos || false,
            ficha_medica.desmayosDetalle || null,
            ficha_medica.hemorragiasNasales || false,
            ficha_medica.hemorragiasNasalesDetalle || null,
            ficha_medica.doloresArticulaciones || false,
            ficha_medica.doloresArticulacionesDetalle || null,
            ficha_medica.piePlano || false,
            ficha_medica.piePlanoDetalle || null,
            ficha_medica.problemasRodillaTobillo || false,
            ficha_medica.problemasRodillaTobilloDetalle || null,
            ficha_medica.cirugias || false,
            ficha_medica.cirugiasDetalle || null,
            ficha_medica.convulsiones || false,
            ficha_medica.convulsionesDetalle || null,
            ficha_medica.problemasRespiratorios || false,
            ficha_medica.problemasRespiratoriosDetalle || null,
            ficha_medica.medicacion || false,
            ficha_medica.medicacionDetalle || null,
            ficha_medica.alergico || false,
            ficha_medica.alergicoDetalle || null,
          ]
        )
      }

      // 4 — Crear inscripciones, suscripciones y reservas
      for (const insc of inscripciones) {
        await crearInscripcion(client, id_cliente, insc, req.user.id)
      }

      await client.query('COMMIT')
      return reply.code(201).send({ id_usuario: usuario.id_usuario, id_cliente, nombre_apellido, dni })

    } catch (e) {
      await client.query('ROLLBACK')
      if (e.code === '23505') return reply.code(409).send({ error: 'El DNI ya está registrado' })
      throw e
    } finally {
      client.release()
    }
  })

  // PUT /api/admin/clientes/:id
  app.put('/:id', admin, async (req, reply) => {
    const { nombre_apellido, venc_ficha_medica, activo, direccion,
            telefono, tel_emergencia, fecha_nac } = req.body
    const { rows } = await query(
      `UPDATE clientes SET
        nomap_c           = COALESCE($1, nomap_c),
        venc_ficha_medica = COALESCE($2, venc_ficha_medica),
        activo_c          = COALESCE($3, activo_c),
        direccion_c       = COALESCE($4, direccion_c),
        telefono_c        = COALESCE($5, telefono_c),
        tel_emergencia_c  = COALESCE($6, tel_emergencia_c),
        fecha_nac_c       = COALESCE($7, fecha_nac_c)
       WHERE id_cliente = $8 RETURNING *`,
      [nombre_apellido, venc_ficha_medica, activo, direccion,
       telefono, tel_emergencia, fecha_nac, req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Cliente no encontrado' })
    return rows[0]
  })

  // ── Huellas (múltiples por cliente, para reintentar con otro dedo) ──

  // GET /api/admin/clientes/:id/huellas
  app.get('/:id/huellas', admin, async (req) => {
    const { rows } = await query(
      `SELECT id_huella, etiqueta, creado_en FROM huellas_cliente WHERE id_cliente = $1 ORDER BY creado_en`,
      [req.params.id]
    )
    return rows
  })

  // POST /api/admin/clientes/:id/huellas — agrega una huella más (no reemplaza)
  app.post('/:id/huellas', admin, async (req, reply) => {
    const { template_huella, etiqueta } = req.body
    if (!template_huella) return reply.code(400).send({ error: 'Falta template_huella' })
    const { rows: [huella] } = await query(
      `INSERT INTO huellas_cliente (id_cliente, template_huella, etiqueta)
       VALUES ($1, $2, $3) RETURNING id_huella, etiqueta, creado_en`,
      [req.params.id, template_huella, etiqueta || null]
    )
    return reply.code(201).send(huella)
  })

  // DELETE /api/admin/clientes/:id/huellas/:idHuella
  app.delete('/:id/huellas/:idHuella', admin, async (req, reply) => {
    const { rowCount } = await query(
      `DELETE FROM huellas_cliente WHERE id_huella = $1 AND id_cliente = $2`,
      [req.params.idHuella, req.params.id]
    )
    if (!rowCount) return reply.code(404).send({ error: 'Huella no encontrada' })
    return { message: 'Huella eliminada' }
  })

  // PUT /api/admin/clientes/:id/pin — PIN alternativo para el molinete
  // (útil sobre todo con niños a los que no les toma bien la huella).
  // Con pin=null se quita.
  app.put('/:id/pin', admin, async (req, reply) => {
    const { pin } = req.body
    try {
      const { rows } = await query(
        `UPDATE clientes SET pin_acceso_c = $1 WHERE id_cliente = $2 RETURNING id_cliente, pin_acceso_c`,
        [pin || null, req.params.id]
      )
      if (!rows[0]) return reply.code(404).send({ error: 'Cliente no encontrado' })
      return rows[0]
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'Ese PIN ya está en uso por otro cliente' })
      throw e
    }
  })

  // PUT /api/admin/clientes/:id/apto-medico
  // Registra la entrega del certificado médico físico. El vencimiento se
  // calcula solo (un año desde la entrega) — no se tipea a mano. Con
  // fecha_entrega=null se limpia (por si se cargó por error).
  app.put('/:id/apto-medico', admin, async (req, reply) => {
    const { fecha_entrega } = req.body
    const { rows } = await query(
      `UPDATE clientes SET
         fecha_entrega_ficha_medica = $1,
         venc_ficha_medica = CASE WHEN $1::date IS NOT NULL THEN $1::date + INTERVAL '1 year' ELSE NULL END
       WHERE id_cliente = $2
       RETURNING id_cliente, fecha_entrega_ficha_medica, venc_ficha_medica`,
      [fecha_entrega || null, req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Cliente no encontrado' })
    return rows[0]
  })

  // PUT /api/admin/clientes/:id/ficha-medica (upsert)
  app.put('/:id/ficha-medica', admin, async (req, reply) => {
    const f = req.body
    await query(
      `INSERT INTO ficha_medica (
         id_cliente, altura, peso, grupo_sanguineo,
         patologia_columna, patologia_columna_det,
         otras_patologias, otras_patologias_det,
         enf_cardiaca, enf_cardiaca_det, lesiones, lesiones_det,
         practica_deportes, practica_deportes_det,
         mareos, mareos_det, dolor_cabeza, dolor_cabeza_det,
         desmayos, desmayos_det, hemorragias_nasales, hemorragias_nasales_det,
         dolores_articulaciones, dolores_articulaciones_det,
         pie_plano, pie_plano_det, problemas_rodilla, problemas_rodilla_det,
         cirugias, cirugias_det, convulsiones, convulsiones_det,
         problemas_respiratorios, problemas_respiratorios_det,
         medicacion, medicacion_det, alergico, alergico_det
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
                 $29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
       ON CONFLICT (id_cliente) DO UPDATE SET
         altura=$2, peso=$3, grupo_sanguineo=$4,
         patologia_columna=$5, patologia_columna_det=$6,
         otras_patologias=$7, otras_patologias_det=$8,
         enf_cardiaca=$9, enf_cardiaca_det=$10, lesiones=$11, lesiones_det=$12,
         practica_deportes=$13, practica_deportes_det=$14,
         mareos=$15, mareos_det=$16, dolor_cabeza=$17, dolor_cabeza_det=$18,
         desmayos=$19, desmayos_det=$20, hemorragias_nasales=$21, hemorragias_nasales_det=$22,
         dolores_articulaciones=$23, dolores_articulaciones_det=$24,
         pie_plano=$25, pie_plano_det=$26, problemas_rodilla=$27, problemas_rodilla_det=$28,
         cirugias=$29, cirugias_det=$30, convulsiones=$31, convulsiones_det=$32,
         problemas_respiratorios=$33, problemas_respiratorios_det=$34,
         medicacion=$35, medicacion_det=$36, alergico=$37, alergico_det=$38`,
      [
        req.params.id,
        f.altura || null, f.peso || null, f.grupoSanguineo || null,
        f.patologiaColumna || false, f.patologiaColumnaDetalle || null,
        f.otrasPatologias || false, f.otrasPatologiasDetalle || null,
        f.enfermedadCardiaca || false, f.enfermedadCardiacaDetalle || null,
        f.lesiones || false, f.lesionesDetalle || null,
        f.practicaDeportes || false, f.practicaDeportesDetalle || null,
        f.mareos || false, f.mareosDetalle || null,
        f.dolorCabeza || false, f.dolorCabezaDetalle || null,
        f.desmayos || false, f.desmayosDetalle || null,
        f.hemorragiasNasales || false, f.hemorragiasNasalesDetalle || null,
        f.doloresArticulaciones || false, f.doloresArticulacionesDetalle || null,
        f.piePlano || false, f.piePlanoDetalle || null,
        f.problemasRodillaTobillo || false, f.problemasRodillaTobilloDetalle || null,
        f.cirugias || false, f.cirugiasDetalle || null,
        f.convulsiones || false, f.convulsionesDetalle || null,
        f.problemasRespiratorios || false, f.problemasRespiratoriosDetalle || null,
        f.medicacion || false, f.medicacionDetalle || null,
        f.alergico || false, f.alergicoDetalle || null,
      ]
    )
    return { message: 'Ficha médica actualizada' }
  })

  // POST /api/admin/clientes/:id/inscripciones
  app.post('/:id/inscripciones', admin, async (req, reply) => {
    const { inscripciones } = req.body
    if (!inscripciones?.length) return reply.code(400).send({ error: 'Sin inscripciones' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const insc of inscripciones) {
        await crearInscripcion(client, req.params.id, insc, req.user.id)
      }
      await client.query('COMMIT')
      return { message: 'Inscripciones agregadas' }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // POST /api/admin/clientes/:id/inscripciones/:idInscripcion/renovar
  // Registra el cobro de un nuevo período (mes) sobre una inscripción existente:
  // crea una fila nueva en suscripciones y, si se pagó, su Ingreso en movimientos.
  app.post('/:id/inscripciones/:idInscripcion/renovar', admin, async (req, reply) => {
    const { id, idInscripcion } = req.params
    const { cantidad_dias, tipo_pago, pago, con_profesor } = req.body

    if (!cantidad_dias || cantidad_dias < 1) {
      return reply.code(400).send({ error: 'cantidad_dias es requerido' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: [insc] } = await client.query(
        `SELECT id_inscripto, id_actividad FROM inscripcion
         WHERE id_inscripto = $1 AND id_cliente = $2`,
        [idInscripcion, id]
      )
      if (!insc) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Inscripción no encontrada para este cliente' })
      }

      const entradas = cantidad_dias * 4

      const { rows: [suscripcion] } = await client.query(
        `INSERT INTO suscripciones
           (id_inscripto, pago_s, tipo_pago_s, fecha_s, cantidad_dias,
            inasistencias_s, entradas_totales, entradas_restantes, con_profesor)
         VALUES ($1,$2,$3,CURRENT_DATE,$4,0,$5,$5,$6)
         RETURNING id_suscripcion, fecha_s, pago_s, cantidad_dias, entradas_totales, entradas_restantes, con_profesor`,
        [insc.id_inscripto, pago || false, tipo_pago || 'efectivo', cantidad_dias, entradas, con_profesor ?? null]
      )

      let monto = 0
      if (pago) {
        const precioInfo = await obtenerPrecioActividad(client, insc.id_actividad, cantidad_dias, con_profesor)
        monto = precioInfo.precio
        await registrarIngresoCuota(client, {
          id_usuario: req.user.id,
          id_suscripcion: suscripcion.id_suscripcion,
          id_inscripto: insc.id_inscripto,
          monto,
          medio_pago: mapearMedioPago(tipo_pago),
          descripcion: `Cuota${precioInfo.nombre_a ? ' ' + precioInfo.nombre_a : ''} - renovación`,
        })
      }

      await client.query('COMMIT')
      return reply.code(201).send({ ...suscripcion, monto })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // DELETE /api/admin/clientes/:id (borrado lógico, alterna activo)
  app.delete('/:id', admin, async (req, reply) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: [c] } = await client.query(
        `UPDATE clientes SET
           activo_c    = NOT activo_c,
           fecha_baja  = CASE WHEN NOT activo_c THEN NULL ELSE CURRENT_DATE END,
           tipo_baja   = CASE WHEN NOT activo_c THEN NULL ELSE 'manual' END,
           motivo_baja = NULL
         WHERE id_cliente = $1
         RETURNING id_usuario, activo_c`,
        [req.params.id]
      )
      if (!c) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Cliente no encontrado' })
      }

      await client.query(
        `UPDATE usuarios SET activo_u = $1 WHERE id_usuario = $2`,
        [c.activo_c, c.id_usuario]
      )

      await client.query('COMMIT')
      return { message: c.activo_c ? 'Cliente reactivado' : 'Cliente desactivado', activo: c.activo_c }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })
}