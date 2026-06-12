import bcrypt from 'bcrypt'
import { query, pool } from '../../config/database.js'

export default async function clientesRoutes(app) {

  const admin = { preHandler: [app.authenticate, app.authorize('Administrador', 'Recepcion')] }

  // GET /api/admin/clientes
  app.get('/', admin, async () => {
    const { rows } = await query(`
      SELECT c.id_cliente, c.nomap_c, c.activo_c, c.venc_ficha_medica,
             c.huella_c, u.dni_u,
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
             )) AS tiene_ficha
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      ORDER BY c.nomap_c
    `)
    return rows
  })

  // GET /api/admin/clientes/:id
  app.get('/:id', admin, async (req, reply) => {
    const { rows } = await query(`
      SELECT c.*, u.dni_u, u.rol_u, u.activo_u
      FROM clientes c JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE c.id_cliente = $1
    `, [req.params.id])
    if (!rows[0]) return reply.code(404).send({ error: 'Cliente no encontrado' })

    const { rows: inscripciones } = await query(`
      SELECT i.id_inscripto, i.id_horario, i.permiso_salida, i.permiso_fotos_redes,
             a.nombre_a, d.nombre_d, i.fecha_inscripcion,
             h.dia_h, h.hora_h, p.nomap_p AS profesor,
             s.id_suscripcion, s.pago_s, s.tipo_pago_s, s.fecha_s,
             s.cantidad_dias, s.inasistencias_s,
             s.entradas_totales, s.entradas_restantes
      FROM inscripcion i
      JOIN actividades a ON a.id_actividad = i.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN horarios h   ON h.id_horario  = i.id_horario
      LEFT JOIN profesores p ON p.id_profesor = h.id_profesor
      LEFT JOIN suscripciones s ON s.id_inscripto = i.id_inscripto
      WHERE i.id_cliente = $1
      ORDER BY i.fecha_inscripcion DESC
    `, [req.params.id])

    const { rows: [ficha] } = await query(
      `SELECT * FROM ficha_medica WHERE id_cliente = $1`,
      [req.params.id]
    )

    return { ...rows[0], inscripciones, ficha_medica: ficha || null }
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

  // ── Helper: crear inscripcion + suscripcion + reserva ─────────
  const crearInscripcion = async (client, id_cliente, insc) => {
    const { rows: [inscripcion] } = await client.query(
      `INSERT INTO inscripcion
         (id_cliente, id_actividad, id_horario, fecha_inscripcion,
          permiso_salida, permiso_fotos_redes)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,$5)
       RETURNING id_inscripto`,
      [id_cliente, insc.id_actividad, insc.id_horario,
       insc.permiso_salida || false, insc.permiso_fotos_redes || false]
    )

    const entradas = (insc.cantidad_dias || 1) * 4

    await client.query(
      `INSERT INTO suscripciones
         (id_inscripto, pago_s, tipo_pago_s, fecha_s, cantidad_dias,
          inasistencias_s, entradas_totales, entradas_restantes)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,0,$5,$5)`,
      [inscripcion.id_inscripto, insc.pago || false,
       insc.tipo_pago || 'efectivo', insc.cantidad_dias || 1, entradas]
    )

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
          template_huella:   { type: 'string' },
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
      template_huella, venc_ficha_medica,
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
           (id_usuario, nomap_c, huella_c, activo_c, venc_ficha_medica,
            direccion_c, telefono_c, tel_emergencia_c, fecha_nac_c)
         VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8)
         RETURNING id_cliente`,
        [usuario.id_usuario, nombre_apellido, template_huella || '',
         venc_ficha_medica || null, direccion || null, telefono || null,
         tel_emergencia || null, fecha_nac || null]
      )

      const id_cliente = nuevoCliente.id_cliente

      // 3 — Crear ficha médica
      if (ficha_medica) {
        await client.query(
          `INSERT INTO ficha_medica (
            id_cliente, altura, peso, grupo_sanguineo,
            patologia_columna, otras_patologias, otras_patologias_det,
            enf_cardiaca, enf_cardiaca_det, lesiones, lesiones_det,
            practica_deportes, practica_deportes_det,
            mareos, dolor_cabeza, desmayos, hemorragias_nasales,
            dolores_articulaciones, pie_plano, problemas_rodilla,
            cirugias, convulsiones, problemas_respiratorios,
            medicacion, medicacion_det, alergico, alergico_det
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                    $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
          [
            id_cliente,
            ficha_medica.altura || null, ficha_medica.peso || null,
            ficha_medica.grupoSanguineo || null,
            ficha_medica.patologiaColumna || false,
            ficha_medica.otrasPatologias || false,
            ficha_medica.otrasPatologiasDetalle || null,
            ficha_medica.enfermedadCardiaca || false,
            ficha_medica.enfermedadCardiacaDetalle || null,
            ficha_medica.lesiones || false,
            ficha_medica.lesionesDetalle || null,
            ficha_medica.practicaDeportes || false,
            ficha_medica.practicaDeportesDetalle || null,
            ficha_medica.mareos || false,
            ficha_medica.dolorCabeza || false,
            ficha_medica.desmayos || false,
            ficha_medica.hemorragiasNasales || false,
            ficha_medica.doloresArticulaciones || false,
            ficha_medica.piePlano || false,
            ficha_medica.problemasRodillaTobillo || false,
            ficha_medica.cirugias || false,
            ficha_medica.convulsiones || false,
            ficha_medica.problemasRespiratorios || false,
            ficha_medica.medicacion || false,
            ficha_medica.medicacionDetalle || null,
            ficha_medica.alergico || false,
            ficha_medica.alergicoDetalle || null,
          ]
        )
      }

      // 4 — Crear inscripciones, suscripciones y reservas
      for (const insc of inscripciones) {
        await crearInscripcion(client, id_cliente, insc)
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
            telefono, tel_emergencia, fecha_nac, huella } = req.body
    const { rows } = await query(
      `UPDATE clientes SET
        nomap_c           = COALESCE($1, nomap_c),
        venc_ficha_medica = COALESCE($2, venc_ficha_medica),
        activo_c          = COALESCE($3, activo_c),
        direccion_c       = COALESCE($4, direccion_c),
        telefono_c        = COALESCE($5, telefono_c),
        tel_emergencia_c  = COALESCE($6, tel_emergencia_c),
        fecha_nac_c       = COALESCE($7, fecha_nac_c),
        huella_c          = COALESCE($8, huella_c)
       WHERE id_cliente = $9 RETURNING *`,
      [nombre_apellido, venc_ficha_medica, activo, direccion,
       telefono, tel_emergencia, fecha_nac, huella || null, req.params.id]
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
         patologia_columna, otras_patologias, otras_patologias_det,
         enf_cardiaca, enf_cardiaca_det, lesiones, lesiones_det,
         practica_deportes, practica_deportes_det,
         mareos, dolor_cabeza, desmayos, hemorragias_nasales,
         dolores_articulaciones, pie_plano, problemas_rodilla,
         cirugias, convulsiones, problemas_respiratorios,
         medicacion, medicacion_det, alergico, alergico_det
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       ON CONFLICT (id_cliente) DO UPDATE SET
         altura=$2, peso=$3, grupo_sanguineo=$4,
         patologia_columna=$5, otras_patologias=$6, otras_patologias_det=$7,
         enf_cardiaca=$8, enf_cardiaca_det=$9, lesiones=$10, lesiones_det=$11,
         practica_deportes=$12, practica_deportes_det=$13,
         mareos=$14, dolor_cabeza=$15, desmayos=$16, hemorragias_nasales=$17,
         dolores_articulaciones=$18, pie_plano=$19, problemas_rodilla=$20,
         cirugias=$21, convulsiones=$22, problemas_respiratorios=$23,
         medicacion=$24, medicacion_det=$25, alergico=$26, alergico_det=$27`,
      [
        req.params.id,
        f.altura||null, f.peso||null, f.grupoSanguineo||null,
        f.patologiaColumna||false, f.otrasPatologias||false,
        f.otrasPatologiasDetalle||null, f.enfermedadCardiaca||false,
        f.enfermedadCardiacaDetalle||null, f.lesiones||false,
        f.lesionesDetalle||null, f.practicaDeportes||false,
        f.practicaDeportesDetalle||null, f.mareos||false,
        f.dolorCabeza||false, f.desmayos||false,
        f.hemorragiasNasales||false, f.doloresArticulaciones||false,
        f.piePlano||false, f.problemasRodillaTobillo||false,
        f.cirugias||false, f.convulsiones||false,
        f.problemasRespiratorios||false, f.medicacion||false,
        f.medicacionDetalle||null, f.alergico||false,
        f.alergicoDetalle||null,
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
        await crearInscripcion(client, req.params.id, insc)
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

  // DELETE /api/admin/clientes/:id (borrado lógico, alterna activo)
  app.delete('/:id', admin, async (req, reply) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: [c] } = await client.query(
        `UPDATE clientes SET activo_c = NOT activo_c
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