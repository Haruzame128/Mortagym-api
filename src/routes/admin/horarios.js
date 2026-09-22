import { query } from "../../config/database.js";

const DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

export default async function horariosRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso("horarios.ver")] };
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso("horarios.gestionar")] };

  // GET /api/admin/horarios
  app.get("/", ver, async (req) => {
    const { actividad } = req.query;

    const { rows } = await query(
      `
    SELECT h.id_horario, h.dia_h, h.hora_h, h.cupo_maximo, h.cupo_actual,
           h.id_actividad, h.id_profesor,
           a.nombre_a, d.nombre_d, p.nomap_p AS profesor_nombre,
           (SELECT STRING_AGG(p2.nomap_p, ', ' ORDER BY p2.nomap_p)
            FROM horario_profesores hp
            JOIN profesores p2 ON p2.id_profesor = hp.id_profesor
            WHERE hp.id_horario = h.id_horario) AS coprofesores_nombres
    FROM horarios h
    JOIN actividades a ON a.id_actividad = h.id_actividad
    JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
    LEFT JOIN profesores p ON p.id_profesor = h.id_profesor
    ${actividad ? "WHERE h.id_actividad = $1" : ""}
    ORDER BY
      ARRAY_POSITION(ARRAY['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'], h.dia_h),
      h.hora_h
  `,
      actividad ? [actividad] : [],
    );

    return rows;
  });

  // POST /api/admin/horarios
  app.post(
    "/",
    {
      ...gestionar,
      schema: {
        body: {
          type: "object",
          required: ["id_actividad", "dia", "hora", "cupo_maximo"],
          properties: {
            id_actividad: { type: "integer" },
            id_profesor: { type: "integer" },
            dia: { type: "string", enum: DIAS },
            hora: { type: "string" },
            cupo_maximo: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const { id_actividad, id_profesor, dia, hora, cupo_maximo } = req.body;

      // VALIDAR DUPLICADO
      const { rows: existente } = await query(
        `SELECT 1
     FROM horarios
     WHERE id_profesor IS NOT DISTINCT FROM $1
       AND dia_h = $2
       AND hora_h = $3
     LIMIT 1`,
        [id_profesor || null, dia, hora],
      );

      if (existente.length > 0) {
        return reply.code(400).send({
          error: "El profesor ya tiene un horario en ese día y hora",
        });
      }

      // INSERTAR
      const { rows } = await query(
        `INSERT INTO horarios (id_actividad, id_profesor, dia_h, hora_h, cupo_maximo, cupo_actual)
     VALUES ($1, $2, $3, $4, $5, 0)
     RETURNING *`,
        [id_actividad, id_profesor || null, dia, hora, cupo_maximo],
      );

      return reply.code(201).send(rows[0]);
    },
  );

  // PUT /api/admin/horarios/:id
  app.put("/:id", {
    ...gestionar,
    schema: {
      body: {
        type: "object",
        properties: {
          dia: { type: "string", enum: DIAS },
          hora: { type: "string" },
          cupo_maximo: { type: "integer", minimum: 1 },
          cupo_actual: { type: "integer", minimum: 0 },
          id_profesor: { type: ["integer", "null"] },
        },
      },
    },
  }, async (req, reply) => {
    const { dia, hora, cupo_maximo, cupo_actual, id_profesor } = req.body;
    const { rows } = await query(
      `UPDATE horarios SET
        dia_h       = COALESCE($1, dia_h),
        hora_h      = COALESCE($2, hora_h),
        cupo_maximo = COALESCE($3, cupo_maximo),
        cupo_actual = COALESCE($4, cupo_actual),
        id_profesor = $5
       WHERE id_horario = $6 RETURNING *`,
      [dia, hora, cupo_maximo, cupo_actual, id_profesor, req.params.id],
    );
    if (!rows[0])
      return reply.code(404).send({ error: "Horario no encontrado" });
    return rows[0];
  });

  // GET /api/admin/horarios/:id/coprofesores — profesores adicionales que
  // dan esa misma clase junto al titular (ej. Natación). Cada uno cobra su
  // sueldo completo por ese horario, de forma independiente.
  app.get("/:id/coprofesores", ver, async (req) => {
    const { rows } = await query(
      `SELECT p.id_profesor, p.nomap_p
       FROM horario_profesores hp
       JOIN profesores p ON p.id_profesor = hp.id_profesor
       WHERE hp.id_horario = $1
       ORDER BY p.nomap_p`,
      [req.params.id],
    );
    return rows;
  });

  // PUT /api/admin/horarios/:id/coprofesores — reemplaza el conjunto completo
  app.put("/:id/coprofesores", {
    ...gestionar,
    schema: {
      body: {
        type: "object",
        required: ["id_profesores"],
        properties: {
          id_profesores: { type: "array", items: { type: "integer" } },
        },
      },
    },
  }, async (req, reply) => {
    const { id_profesores } = req.body;

    const { rows: [horario] } = await query(
      `SELECT id_profesor FROM horarios WHERE id_horario = $1`,
      [req.params.id],
    );
    if (!horario) return reply.code(404).send({ error: "Horario no encontrado" });
    if (id_profesores.some((id) => Number(id) === Number(horario.id_profesor))) {
      return reply.code(400).send({ error: "El titular del horario no puede cargarse también como co-profesor" });
    }

    await query(`DELETE FROM horario_profesores WHERE id_horario = $1`, [req.params.id]);
    for (const id_profesor of id_profesores) {
      await query(
        `INSERT INTO horario_profesores (id_horario, id_profesor) VALUES ($1, $2)`,
        [req.params.id, id_profesor],
      );
    }
    return { message: "Co-profesores actualizados" };
  });

  // DELETE /api/admin/horarios/:id
  app.delete("/:id", gestionar, async (req, reply) => {
    await query(`DELETE FROM horarios WHERE id_horario = $1`, [req.params.id]);
    return { message: "Horario eliminado" };
  });
}
