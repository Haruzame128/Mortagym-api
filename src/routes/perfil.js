import { query } from "../config/database.js";

function limpiarTexto(valor) {
  if (valor === undefined) return { recibido: false, valor: null };
  const texto = String(valor).trim();
  return { recibido: true, valor: texto === "" ? null : texto };
}

export default async function perfilRoutes(app) {
  const cliente = { preHandler: [app.authenticate, app.authorize("Cliente")] };

  // GET /api/perfil/me
  app.get("/me", cliente, async (req, reply) => {
    const {
      rows: [perfil],
    } = await query(
      `
      SELECT c.id_cliente, c.nomap_c, c.direccion_c, c.telefono_c,
             c.tel_emergencia_c, c.fecha_nac_c, c.venc_ficha_medica, c.activo_c,
             u.dni_u,
             EXISTS(SELECT 1 FROM ficha_medica fm WHERE fm.id_cliente = c.id_cliente) AS tiene_ficha
      FROM clientes c
      INNER JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE c.id_usuario = $1
    `,
      [req.user.id],
    );

    if (!perfil)
      return reply
        .code(404)
        .send({ error: "No se encontró el perfil del cliente" });

    const { rows: inscripciones } = await query(
      `
      SELECT
        i.id_inscripto, i.fecha_inscripcion,
        a.id_actividad, a.nombre_a,
        d.id_disciplina, d.nombre_d, d.tipo_d,
        h.id_horario, h.dia_h, h.hora_h,
        p.nomap_p AS profesor,
        suscripcion.id_suscripcion, suscripcion.pago_s, suscripcion.tipo_pago_s,
        suscripcion.fecha_s, suscripcion.cantidad_dias,
        suscripcion.entradas_totales, suscripcion.entradas_restantes,
        CASE
          WHEN suscripcion.id_suscripcion IS NULL THEN false
          WHEN suscripcion.pago_s = true
            AND suscripcion.entradas_restantes > 0
            AND EXTRACT(MONTH FROM suscripcion.fecha_s) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR  FROM suscripcion.fecha_s) = EXTRACT(YEAR  FROM CURRENT_DATE)
          THEN true
          ELSE false
        END AS suscripcion_vigente
      FROM inscripcion i
      INNER JOIN actividades a  ON a.id_actividad  = i.id_actividad
      INNER JOIN disciplinas d  ON d.id_disciplina = a.id_disciplina
      LEFT  JOIN horarios h     ON h.id_horario    = i.id_horario
      LEFT  JOIN profesores p   ON p.id_profesor   = h.id_profesor
      LEFT JOIN LATERAL (
        SELECT s.id_suscripcion, s.pago_s, s.tipo_pago_s, s.fecha_s,
               s.cantidad_dias, s.entradas_totales, s.entradas_restantes
        FROM suscripciones s
        WHERE s.id_inscripto = i.id_inscripto
        ORDER BY s.fecha_s DESC, s.id_suscripcion DESC
        LIMIT 1
      ) AS suscripcion ON true
      WHERE i.id_cliente = $1
      ORDER BY d.nombre_d, a.nombre_a, h.dia_h, h.hora_h
    `,
      [perfil.id_cliente],
    );

    const cuota_al_dia = inscripciones.some(
      (i) => i.suscripcion_vigente === true,
    );
    const entradas_restantes = inscripciones.reduce(
      (t, i) =>
        i.suscripcion_vigente ? t + Number(i.entradas_restantes || 0) : t,
      0,
    );

    return reply.send({
      ...perfil,
      cuota_al_dia,
      entradas_restantes,
      inscripciones,
    });
  });

  // PATCH /api/perfil/me
  app.patch(
    "/me",
    {
      ...cliente,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            direccion: { type: "string", maxLength: 200 },
            telefono: { type: "string", maxLength: 50 },
            tel_emergencia: { type: "string", maxLength: 50 },
          },
        },
      },
    },
    async (req, reply) => {
      const direccion = limpiarTexto(req.body.direccion);
      const telefono = limpiarTexto(req.body.telefono);
      const telEmergencia = limpiarTexto(req.body.tel_emergencia);

      const {
        rows: [p],
      } = await query(
        `
      UPDATE clientes SET
        direccion_c       = CASE WHEN $1::boolean THEN $2 ELSE direccion_c END,
        telefono_c        = CASE WHEN $3::boolean THEN $4 ELSE telefono_c END,
        tel_emergencia_c  = CASE WHEN $5::boolean THEN $6 ELSE tel_emergencia_c END
      WHERE id_usuario = $7
      RETURNING id_cliente, nomap_c, direccion_c, telefono_c, tel_emergencia_c,
                fecha_nac_c, venc_ficha_medica, activo_c
    `,
        [
          direccion.recibido,
          direccion.valor,
          telefono.recibido,
          telefono.valor,
          telEmergencia.recibido,
          telEmergencia.valor,
          req.user.id,
        ],
      );

      if (!p)
        return reply
          .code(404)
          .send({ error: "No se encontró el perfil del cliente" });
      return reply.send({ mensaje: "Datos actualizados", perfil: p });
    },
  );

  // GET /api/perfil/horarios-musculacion
  app.get("/horarios-musculacion", cliente, async (req, reply) => {
    const {
      rows: [c],
    } = await query(`SELECT id_cliente FROM clientes WHERE id_usuario = $1`, [
      req.user.id,
    ]);
    if (!c) return reply.code(404).send({ error: "Cliente no encontrado" });

    const { rows } = await query(
      `
      SELECT h.id_horario, h.dia_h, h.hora_h, h.cupo_maximo, h.cupo_actual,
             EXISTS(
               SELECT 1 FROM reserva_musculacion rm
               WHERE rm.id_horario = h.id_horario AND rm.id_cliente = $1
             ) AS es_mi_reserva,
             (SELECT rm.id_reserva_musculacion FROM reserva_musculacion rm
              WHERE rm.id_horario = h.id_horario AND rm.id_cliente = $1 LIMIT 1) AS id_reserva
      FROM horarios h
      INNER JOIN actividades a ON a.id_actividad  = h.id_actividad
      INNER JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      WHERE d.tipo_d = 'musculacion'
      ORDER BY
        ARRAY_POSITION(ARRAY['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'], h.dia_h),
        h.hora_h
    `,
      [c.id_cliente],
    );

    return reply.send(rows);
  });

  // ── RUTINAS ────────────────────────────────────────────────────

  // GET /api/perfil/rutina?mes=Julio
  app.get("/rutina", cliente, async (req, reply) => {
    const {
      rows: [c],
    } = await query(`SELECT id_cliente FROM clientes WHERE id_usuario = $1`, [
      req.user.id,
    ]);
    if (!c) return reply.code(404).send({ error: "Cliente no encontrado" });

    const mes =
      req.query.mes || new Date().toLocaleString("es-AR", { month: "long" });

    const { rows } = await query(
      `
      SELECT
        cr.id_cronograma, cr.semana_c, cr.mes_c,
        r.id_rutina, r.dia_r, r.series_r, r.repeticiones_r, r.peso_r,
        e.nombre_e AS ejercicio, e.categoria_e,
        p.id_progreso, p.series_cliente, p.repeticion_cliente, p.peso_cliente, p.fecha
      FROM cronograma cr
      JOIN rutinas r    ON r.id_rutina    = cr.id_rutina
      JOIN ejercicios e ON e.id_ejercicio = r.id_ejercicio
      LEFT JOIN progreso p ON p.id_rutina = r.id_rutina AND p.semana_p = cr.semana_c
      WHERE cr.id_cliente = $1 AND cr.mes_c = $2
      ORDER BY cr.semana_c, r.dia_r, e.categoria_e, e.nombre_e
    `,
      [c.id_cliente, mes],
    );

    return reply.send(rows);
  });

  // POST /api/perfil/progreso — guardar progreso de un ejercicio
  app.post(
    "/progreso",
    {
      ...cliente,
      schema: {
        body: {
          type: "object",
          required: ["id_rutina", "semana", "series", "repeticiones", "peso"],
          properties: {
            id_rutina: { type: "integer" },
            semana: { type: "integer" },
            series: { type: "number" },
            repeticiones: { type: "number" },
            peso: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const { id_rutina, semana, series, repeticiones, peso } = req.body;

      await query(
        `
      INSERT INTO progreso (id_rutina, semana_p, series_cliente, repeticion_cliente, peso_cliente, fecha)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
      ON CONFLICT (id_rutina, semana_p) DO UPDATE SET
        series_cliente     = EXCLUDED.series_cliente,
        repeticion_cliente = EXCLUDED.repeticion_cliente,
        peso_cliente       = EXCLUDED.peso_cliente,
        fecha              = CURRENT_DATE
    `,
        [id_rutina, semana, series, repeticiones, peso],
      );

      return reply.send({ message: "Progreso guardado" });
    },
  );
}
