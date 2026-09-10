import { query } from "../config/database.js";

export default async function perfilRoutes(app) {
  const cliente = { preHandler: [app.authenticate, app.authorize("Cliente")] };

  // GET /api/perfil/me — datos del cliente logueado
  app.get("/me", cliente, async (req, reply) => {
    const id_usuario = req.user.id;

    const {
      rows: [c],
    } = await query(
      `
      SELECT c.id_cliente, c.nomap_c, c.venc_ficha_medica,
             c.direccion_c, c.telefono_c, c.fecha_nac_c,
             u.dni_u,
             (SELECT EXISTS(
               SELECT 1 FROM ficha_medica fm WHERE fm.id_cliente = c.id_cliente
             )) AS tiene_ficha,
             plan.id_plan AS plan_nutricion_id,
             plan.archivo_pdf AS plan_nutricion_url,
             plan.nombre_original AS plan_nutricion_nombre,
             plan.creado_en AS plan_nutricion_fecha
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      LEFT JOIN LATERAL (
        SELECT id_plan, archivo_pdf, nombre_original, creado_en
        FROM planes_nutricion p
        WHERE p.id_cliente = c.id_cliente
        ORDER BY p.creado_en DESC LIMIT 1
      ) plan ON true
      WHERE u.id_usuario = $1
    `,
      [id_usuario],
    );

    if (!c) return reply.code(404).send({ error: "Perfil no encontrado" });

    const { rows: inscripciones } = await query(
      `
      SELECT i.id_inscripto, a.nombre_a, d.nombre_d, d.tipo_d,
             h.dia_h, h.hora_h,
             p.nomap_p AS profesor,
             s.pago_s, s.cantidad_dias, s.fecha_s,
             s.entradas_totales, s.entradas_restantes
      FROM inscripcion i
      JOIN actividades a  ON a.id_actividad  = i.id_actividad
      JOIN disciplinas d  ON d.id_disciplina = a.id_disciplina
      LEFT JOIN horarios h   ON h.id_horario  = i.id_horario
      LEFT JOIN profesores p ON p.id_profesor = h.id_profesor
      LEFT JOIN suscripciones s ON s.id_inscripto = i.id_inscripto
      WHERE i.id_cliente = $1
      ORDER BY d.nombre_d, a.nombre_a
    `,
      [c.id_cliente],
    );

    const cuota_al_dia = inscripciones.some((i) => i.pago_s === true);
    const entradas_restantes = inscripciones.reduce(
      (sum, i) => sum + Number(i.entradas_restantes || 0),
      0,
    );

    return {
      ...c,
      inscripciones,
      cuota_al_dia,
      entradas_restantes,
      tiene_plan_nutricion: c.plan_nutricion_id != null,
    };
  });

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
            WHERE rm.id_horario = h.id_horario AND rm.id_cliente = $1) AS id_reserva
    FROM horarios h
    JOIN actividades a  ON a.id_actividad  = h.id_actividad
    JOIN disciplinas d  ON d.id_disciplina = a.id_disciplina
    WHERE d.tipo_d = 'musculacion'
    ORDER BY
      ARRAY_POSITION(ARRAY['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'], h.dia_h),
      h.hora_h
  `,
      [c.id_cliente],
    );

    return rows;
  });
}
