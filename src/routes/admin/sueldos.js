import { query, pool } from '../../config/database.js'

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']

// Lista las fechas concretas en que cae un día de la semana (ej. "Miercoles")
// dentro de [fechaInicio, fechaFinExcl) — reemplaza el viejo placeholder de
// "4 semanas por mes", que asumía todos los meses iguales y no servía para
// un rango arbitrario (ej. las 2 semanas de un profesor que entró a mitad
// de mes). Devolver las fechas (no solo el conteo) permite después tachar
// las que el profesor no dio por inasistencia.
const fechasDelDia = (diaH, fechaInicio, fechaFinExcl) => {
  const dow = DIAS_SEMANA.indexOf(diaH)
  if (dow === -1) return []
  const fechas = []
  const cursor = new Date(`${fechaInicio}T00:00:00Z`)
  const fin = new Date(`${fechaFinExcl}T00:00:00Z`)
  while (cursor < fin) {
    if (cursor.getUTCDay() === dow) fechas.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return fechas
}

// El match "es este profesor" ahora contempla dos casos: que sea el
// profesor titular del horario (h.id_profesor) o que esté cargado como
// co-profesor de ese mismo horario (horario_profesores) — para disciplinas
// donde dos profesores dan la misma clase juntos (ej. Natación). Cada uno
// cobra completo, como si estuviera solo a cargo.
const ES_PROFESOR_DEL_HORARIO_SQL = `
  (h.id_profesor = $1 OR EXISTS (
    SELECT 1 FROM horario_profesores hp
    WHERE hp.id_horario = h.id_horario AND hp.id_profesor = $1
  ))
`

// Tolerancia para considerar que la fichada (tabla "asistencia" — entrada y
// salida real marcadas por el profesor) corresponde a una clase puntual.
// Es solo informativo/de verificación: no reemplaza al checkbox manual de
// asistencia_profesor, que sigue siendo lo único que afecta el monto — así
// no se empieza a descontar sueldo solo porque todavía no hay fichadas
// reales cargadas para todos los días.
const TOLERANCIA_FICHADA_MIN = 30

// Busca las fichadas del profesor ese día y si alguna cubre la hora de la
// clase (entrada menos tolerancia, salida más tolerancia). Devuelve null si
// no fichó nada ese día; si fichó pero ningún turno cubre esa clase puntual,
// devuelve las fichadas igual con dentro_tolerancia=false (para poder avisar
// "fichó, pero no a esta hora" en vez de "no fichó nada").
const buscarFichada = (fichadas, fecha, horaH) => {
  const horaClase = new Date(`${fecha}T${horaH}`)
  const delDia = fichadas.filter((f) => new Date(f.hora_fecha_entrada).toDateString() === horaClase.toDateString())
  if (delDia.length === 0) return null

  const cubre = delDia.find((f) => {
    const entrada = new Date(f.hora_fecha_entrada)
    const salida = new Date(f.hora_fecha_salida)
    const desde = new Date(entrada.getTime() - TOLERANCIA_FICHADA_MIN * 60000)
    const hasta = new Date(salida.getTime() + TOLERANCIA_FICHADA_MIN * 60000)
    return horaClase >= desde && horaClase <= hasta
  })

  const elegida = cubre || delDia[0]
  return {
    hora_entrada: elegida.hora_fecha_entrada,
    hora_salida: elegida.hora_fecha_salida,
    dentro_tolerancia: !!cubre,
  }
}

// ── Cálculo por modalidad ─────────────────────────────────────────
// Cada condición (disciplina + modalidad + valor) de un contrato aporta al
// sueldo mirando una fuente distinta:
//  - porcentaje: recaudado real (movimientos) de esa disciplina en el rango x valor%.
//  - por_hora: ocurrencias reales de cada horario de grilla del profesor en
//    esa disciplina dentro del rango elegido x valor.
//  - monto_fijo: por alumno pago en el rango, usando precios.precio_N_profesor
//    según sus días/semana (hoy solo cargado para Natación); si no hay precio
//    cargado para esa disciplina, cae al valor fijo tipeado en el contrato.

const calcularPorcentaje = async (id_profesor, id_disciplina, valor, fechaInicio, fechaFinExcl) => {
  const { rows: roster } = await query(`
    SELECT c.id_cliente AS cliente_id, c.nomap_c AS cliente_nombre,
           a.nombre_a, h.dia_h, h.hora_h,
           COALESCE(pagos.monto, 0) AS monto,
           CASE WHEN pagos.monto IS NOT NULL THEN 'Pagado' ELSE 'Pendiente' END AS estado_pago
    FROM inscripcion i
    JOIN clientes    c ON c.id_cliente   = i.id_cliente
    JOIN horarios    h ON h.id_horario   = i.id_horario
    JOIN actividades a ON a.id_actividad = i.id_actividad
    LEFT JOIN LATERAL (
      SELECT SUM(m.monto_m) AS monto
      FROM suscripciones s
      JOIN movimientos   m ON m.id_suscripcion = s.id_suscripcion
      WHERE s.id_inscripto = i.id_inscripto
        AND m.tipo_m = 'Ingreso' AND m.anulado_m = false
        AND m.fecha_m >= $3 AND m.fecha_m < $4
    ) pagos ON true
    WHERE ${ES_PROFESOR_DEL_HORARIO_SQL} AND a.id_disciplina = $2 AND c.activo_c = true
    ORDER BY c.nomap_c
  `, [id_profesor, id_disciplina, fechaInicio, fechaFinExcl])

  const pagaron = roster.filter(r => r.estado_pago === 'Pagado')
  const recaudado = pagaron.reduce((sum, r) => sum + Number(r.monto), 0)
  const clientes = new Set(pagaron.map(r => r.cliente_id)).size

  return {
    monto: recaudado * (Number(valor) / 100),
    clientes,
    recaudado,
    detalle: roster,
  }
}

const calcularPorHora = async (id_profesor, id_disciplina, valor, fechaInicio, fechaFinExcl) => {
  const { rows: horarios } = await query(`
    SELECT h.id_horario, h.dia_h, h.hora_h, a.nombre_a
    FROM horarios h
    JOIN actividades a ON a.id_actividad = h.id_actividad
    WHERE ${ES_PROFESOR_DEL_HORARIO_SQL} AND a.id_disciplina = $2
    ORDER BY h.dia_h, h.hora_h
  `, [id_profesor, id_disciplina])

  // "La ausencia es la excepción": por defecto se asume que dio la clase.
  // Solo se resta si hay una fila explícita marcando que faltó ese día.
  const idsHorario = horarios.map(h => h.id_horario)
  let ausentes = new Set()
  if (idsHorario.length > 0) {
    const { rows: faltas } = await query(`
      SELECT id_horario, fecha FROM asistencia_profesor
      WHERE id_profesor = $1 AND id_horario = ANY($2::bigint[]) AND asistio = false
        AND fecha >= $3 AND fecha < $4
    `, [id_profesor, idsHorario, fechaInicio, fechaFinExcl])
    ausentes = new Set(faltas.map(f => `${f.id_horario}|${new Date(f.fecha).toISOString().slice(0, 10)}`))
  }

  // Fichadas reales del profesor en el rango (tabla "asistencia") — solo
  // para mostrar de qué hora a qué hora marcó y si eso cubre la clase; no
  // afecta el monto, que sigue dependiendo únicamente del checkbox manual.
  const { rows: fichadas } = await query(`
    SELECT hora_fecha_entrada, hora_fecha_salida FROM asistencia
    WHERE id_profesor = $1 AND hora_fecha_entrada >= $2 AND hora_fecha_entrada < $3
    ORDER BY hora_fecha_entrada
  `, [id_profesor, fechaInicio, fechaFinExcl])

  const detalle = horarios.map(h => {
    const fechas = fechasDelDia(h.dia_h, fechaInicio, fechaFinExcl).map(fecha => ({
      fecha,
      asistio: !ausentes.has(`${h.id_horario}|${fecha}`),
      fichada: buscarFichada(fichadas, fecha, h.hora_h),
    }))
    return { ...h, fechas, ocurrencias: fechas.filter(f => f.asistio).length }
  })
  const horas = detalle.reduce((sum, h) => sum + h.ocurrencias, 0)

  return {
    monto: horas * Number(valor),
    clientes: 0,
    horas,
    detalle,
  }
}

const calcularMontoFijo = async (id_profesor, id_disciplina, valor, fechaInicio, fechaFinExcl) => {
  const { rows: alumnos } = await query(`
    SELECT DISTINCT ON (i.id_inscripto)
           c.id_cliente AS cliente_id, c.nomap_c AS cliente_nombre,
           s.cantidad_dias,
           CASE s.cantidad_dias
             WHEN 1 THEN pr.precio_1_profesor WHEN 2 THEN pr.precio_2_profesor
             WHEN 3 THEN pr.precio_3_profesor WHEN 4 THEN pr.precio_4_profesor
             WHEN 5 THEN pr.precio_5_profesor WHEN 6 THEN pr.precio_6_profesor
           END AS precio_profesor
    FROM movimientos m
    JOIN suscripciones s ON s.id_suscripcion = m.id_suscripcion
    JOIN inscripcion   i ON i.id_inscripto   = s.id_inscripto
    JOIN clientes      c ON c.id_cliente     = i.id_cliente
    JOIN horarios      h ON h.id_horario     = i.id_horario
    JOIN actividades   a ON a.id_actividad   = i.id_actividad
    JOIN disciplinas   d ON d.id_disciplina  = a.id_disciplina
    LEFT JOIN precios  pr ON pr.id_precio    = COALESCE(a.id_precio, d.id_precio)
    WHERE ${ES_PROFESOR_DEL_HORARIO_SQL} AND a.id_disciplina = $2
      AND m.tipo_m = 'Ingreso' AND m.anulado_m = false
      AND m.fecha_m >= $3 AND m.fecha_m < $4
    ORDER BY i.id_inscripto, m.fecha_m DESC
  `, [id_profesor, id_disciplina, fechaInicio, fechaFinExcl])

  const detalle = alumnos.map(a => ({
    ...a,
    monto: Number(a.precio_profesor) || Number(valor),
  }))
  const monto = detalle.reduce((sum, a) => sum + a.monto, 0)

  return { monto, clientes: detalle.length, detalle }
}

const calcularCondicion = async (id_profesor, cond, fechaInicio, fechaFinExcl) => {
  const { id_disciplina, modalidad, valor } = cond
  if (modalidad === 'porcentaje') return calcularPorcentaje(id_profesor, id_disciplina, valor, fechaInicio, fechaFinExcl)
  if (modalidad === 'por_hora')   return calcularPorHora(id_profesor, id_disciplina, valor, fechaInicio, fechaFinExcl)
  return calcularMontoFijo(id_profesor, id_disciplina, valor, fechaInicio, fechaFinExcl)
}

// Profesores + el contrato que regía DURANTE el rango liquidado (no el
// vigente hoy). Sin esto, recalcular un período viejo después de una
// renovación da otro número.
const contratoDelRango = async (fechaInicio, fechaFinExcl) => {
  const { rows } = await query(`
    SELECT DISTINCT ON (p.id_profesor)
           p.id_profesor, p.nomap_p, c.id_contrato
    FROM profesores p
    JOIN contratos_profesor c
      ON c.id_profesor = p.id_profesor
     AND c.fecha_alta < $2
     AND (c.fecha_baja IS NULL OR c.fecha_baja >= $1)
    ORDER BY p.id_profesor, c.fecha_alta DESC
  `, [fechaInicio, fechaFinExcl])
  return rows
}

const condicionesDe = async (id_contrato) => {
  const { rows } = await query(`
    SELECT cc.id_disciplina, d.nombre_d AS disciplina, cc.modalidad, cc.valor
    FROM contrato_condiciones cc
    JOIN disciplinas d ON d.id_disciplina = cc.id_disciplina
    WHERE cc.id_contrato = $1
    ORDER BY d.nombre_d
  `, [id_contrato])
  return rows
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

// Valida desde/hasta (ambas inclusive tal como las elige el usuario) y
// devuelve el rango [fechaInicio, fechaFinExcl) que esperan las funciones de
// cálculo de arriba.
const validarRango = (desde, hasta) => {
  if (!desde || !hasta || !FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) {
    return { error: 'Los parámetros desde y hasta son requeridos, en formato YYYY-MM-DD' }
  }
  if (hasta < desde) {
    return { error: 'La fecha hasta no puede ser anterior a la fecha desde' }
  }
  const fin = new Date(`${hasta}T00:00:00Z`)
  fin.setUTCDate(fin.getUTCDate() + 1)
  return { fechaInicio: desde, fechaFinExcl: fin.toISOString().split('T')[0] }
}

export default async function sueldosRoutes(app) {
  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }

  // GET /api/admin/sueldos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — Calcula sueldos del período
  app.get('/', admin, async (req, reply) => {
    const { desde, hasta } = req.query
    const rango = validarRango(desde, hasta)
    if (rango.error) return reply.code(400).send({ error: rango.error })
    const { fechaInicio, fechaFinExcl } = rango

    const profesores = await contratoDelRango(fechaInicio, fechaFinExcl)

    const sueldos = await Promise.all(
      profesores.map(async (prof) => {
        const condiciones = await condicionesDe(prof.id_contrato)

        let monto = 0
        let clientes_pagos = 0
        for (const cond of condiciones) {
          const r = await calcularCondicion(prof.id_profesor, cond, fechaInicio, fechaFinExcl)
          monto += r.monto
          clientes_pagos += r.clientes
        }

        const { rows: pagado } = await query(`
          SELECT id_sueldo FROM sueldos_pagados
          WHERE id_profesor = $1 AND fecha_desde <= $3 AND fecha_hasta >= $2
          LIMIT 1
        `, [prof.id_profesor, desde, hasta])

        return {
          profesor_id: prof.id_profesor,
          profesor_nombre: prof.nomap_p,
          condiciones: condiciones.map(c => ({ disciplina: c.disciplina, modalidad: c.modalidad, valor: c.valor })),
          clientes_pagos,
          monto: parseFloat(monto.toFixed(2)),
          estado: pagado.length > 0 ? 'Pagado' : 'Pendiente',
        }
      }),
    )

    return sueldos
  })

  // GET /api/admin/sueldos/historial — Historial de pagos
  app.get('/historial', admin, async () => {
    const { rows } = await query(`
      SELECT
        sp.id_sueldo, sp.id_profesor, p.nomap_p AS profesor_nombre,
        sp.mes, sp.fecha_desde, sp.fecha_hasta, sp.monto, sp.medio_pago, sp.numero_comprobante,
        sp.observaciones, sp.fecha_pago, sp.creado_en
      FROM sueldos_pagados sp
      JOIN profesores p ON p.id_profesor = sp.id_profesor
      ORDER BY sp.fecha_pago DESC, sp.creado_en DESC
    `)
    return rows
  })

  // GET /api/admin/sueldos/profesor/:id?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — Detalle de cálculo
  app.get('/profesor/:id', admin, async (req, reply) => {
    const { id } = req.params
    const { desde, hasta } = req.query
    const rango = validarRango(desde, hasta)
    if (rango.error) return reply.code(400).send({ error: rango.error })
    const { fechaInicio, fechaFinExcl } = rango

    const { rows: [profesor] } = await query(`
      SELECT id_profesor, nomap_p FROM profesores WHERE id_profesor = $1
    `, [id])
    if (!profesor) return reply.code(404).send({ error: 'Profesor no encontrado' })

    const { rows: [contratoDelRangoRow] } = await query(`
      SELECT id_contrato, fecha_alta, fecha_vencimiento, estado
      FROM contratos_profesor
      WHERE id_profesor = $1 AND fecha_alta < $3
        AND (fecha_baja IS NULL OR fecha_baja >= $2)
      ORDER BY fecha_alta DESC
      LIMIT 1
    `, [id, fechaInicio, fechaFinExcl])

    if (!contratoDelRangoRow) {
      return reply.code(404).send({ error: 'El profesor no tenía contrato vigente en ese período' })
    }

    const condiciones = await condicionesDe(contratoDelRangoRow.id_contrato)

    const condicionesConMonto = await Promise.all(condiciones.map(async (cond) => {
      const r = await calcularCondicion(id, cond, fechaInicio, fechaFinExcl)
      return {
        id_disciplina: cond.id_disciplina,
        disciplina: cond.disciplina,
        modalidad: cond.modalidad,
        valor: cond.valor,
        monto: parseFloat(r.monto.toFixed(2)),
        clientes: r.clientes,
        horas: r.horas,
        detalle: r.detalle,
      }
    }))

    const monto_final = condicionesConMonto.reduce((sum, c) => sum + c.monto, 0)
    const clientes_pagos = condicionesConMonto.reduce((sum, c) => sum + c.clientes, 0)

    const { rows: pagado } = await query(`
      SELECT id_sueldo FROM sueldos_pagados
      WHERE id_profesor = $1 AND fecha_desde <= $3 AND fecha_hasta >= $2
    `, [id, desde, hasta])

    return {
      profesor_id: profesor.id_profesor,
      profesor_nombre: profesor.nomap_p,
      desde,
      hasta,
      contrato: contratoDelRangoRow,
      condiciones: condicionesConMonto,
      clientes_pagos,
      monto_final: parseFloat(monto_final.toFixed(2)),
      estado: pagado.length > 0 ? 'Pagado' : 'Pendiente',
    }
  })

  // PUT /api/admin/sueldos/asistencia — Marcar inasistencias del profesor
  // en clases "por_hora". Solo se guarda fila cuando asistio=false (marcar
  // que faltó); si se destilda (vuelve a asistio=true) se borra la fila,
  // porque el default sin fila ya es "sí dio la clase".
  app.put('/asistencia', admin, async (req, reply) => {
    const { id_profesor, marcas } = req.body
    if (!id_profesor || !Array.isArray(marcas)) {
      return reply.code(400).send({ error: 'id_profesor y marcas (array) son requeridos' })
    }
    for (const m of marcas) {
      if (!m.id_horario || !m.fecha) continue
      if (m.asistio === false) {
        await query(`
          INSERT INTO asistencia_profesor (id_horario, id_profesor, fecha, asistio, actualizado_en)
          VALUES ($1, $2, $3, false, now())
          ON CONFLICT (id_horario, id_profesor, fecha) DO UPDATE SET asistio = false, actualizado_en = now()
        `, [m.id_horario, id_profesor, m.fecha])
      } else {
        await query(`
          DELETE FROM asistencia_profesor WHERE id_horario = $1 AND id_profesor = $2 AND fecha = $3
        `, [m.id_horario, id_profesor, m.fecha])
      }
    }
    return { message: 'Asistencia actualizada' }
  })

  // POST /api/admin/sueldos/pago — Registrar pago de sueldo
  app.post('/pago', admin, async (req, reply) => {
    const {
      profesor_id, profesor_nombre, desde, hasta, monto,
      medio_pago, numero_comprobante, observaciones, fecha, detalle,
    } = req.body

    if (!profesor_id || !desde || !hasta || !monto || !medio_pago) {
      return reply.code(400).send({
        error: 'Faltan campos requeridos: profesor_id, desde, hasta, monto, medio_pago',
      })
    }
    if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) {
      return reply.code(400).send({ error: 'desde y hasta deben estar en formato YYYY-MM-DD' })
    }
    if (monto <= 0) {
      return reply.code(400).send({ error: 'El monto debe ser mayor a 0' })
    }

    // Sin columna propia para guardar el detalle del cálculo, lo dejamos
    // en observaciones (si el usuario no cargó una propia) para que el
    // número siga siendo reproducible aunque después se anule un movimiento.
    const observacionesFinal = observaciones
      || (detalle ? `Detalle del cálculo: ${JSON.stringify(detalle)}` : null)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Un período ya pagado que se superponga con el nuevo bloquea el alta
      // (evita pagar dos veces el mismo tramo, pero permite tramos distintos
      // del mismo profesor, ej. primera y segunda quincena por separado).
      const { rows: existing } = await client.query(`
        SELECT id_sueldo FROM sueldos_pagados
        WHERE id_profesor = $1 AND fecha_desde <= $3 AND fecha_hasta >= $2
      `, [profesor_id, desde, hasta])

      if (existing.length > 0) {
        await client.query('ROLLBACK')
        return reply.code(409).send({
          error: 'Ya existe un pago registrado para este profesor que se superpone con ese período',
        })
      }

      const { rows: [sueldo] } = await client.query(`
        INSERT INTO sueldos_pagados (
          id_profesor, fecha_desde, fecha_hasta, monto, medio_pago,
          numero_comprobante, observaciones, fecha_pago
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id_sueldo, id_profesor, fecha_desde, fecha_hasta, monto, medio_pago,
                  numero_comprobante, observaciones, fecha_pago, creado_en
      `, [
        profesor_id, desde, hasta, monto, medio_pago,
        numero_comprobante || null, observacionesFinal,
        fecha || new Date().toISOString().split('T')[0],
      ])

      const { rows: [categoria] } = await client.query(`
        SELECT id_categoria FROM categorias_movimiento WHERE nombre_cm = 'Sueldo' LIMIT 1
      `)

      if (categoria) {
        await client.query(`
          INSERT INTO movimientos (
            id_categoria, id_usuario, tipo_m, monto_m,
            descripcion_m, medio_pago_m, fecha_m, origen_m
          )
          VALUES ($1, $2, 'Egreso', $3, $4, $5, $6, 'Automatico')
        `, [
          categoria.id_categoria, req.user.id, monto,
          `Sueldo ${profesor_nombre} - ${desde} a ${hasta}`, medio_pago,
          fecha || new Date().toISOString().split('T')[0],
        ])
      }

      await client.query('COMMIT')

      return reply.code(201).send({
        id: sueldo.id_sueldo,
        success: true,
        message: 'Sueldo registrado correctamente',
        ...sueldo,
      })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })
}
