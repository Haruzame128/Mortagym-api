import { query } from "../../config/database.js";

const DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

export default async function horariosRoutes(app) {
  const admin = {
    preHandler: [app.authenticate, app.authorize("Administrador")],
  };

  // GET /api/admin/horarios
  app.get("/", admin, async () => {
    const { rows } = await query(`
      SELECT h.id_horario, h.dia_h, h.hora_h, h.cupo_maximo, h.cupo_actual,
             h.id_actividad, h.id_profesor,
             a.nombre_a, d.nombre_d, p.nomap_p AS profesor_nombre
      FROM horarios h
      JOIN actividades a ON a.id_actividad = h.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN profesores p ON p.id_profesor = h.id_profesor
      ORDER BY
        ARRAY_POSITION(ARRAY['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'], h.dia_h),
        h.hora_h
    `);
    return rows;
  });

  // POST /api/admin/horarios
  app.post(
    "/",
    {
      ...admin,
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
  app.put("/:id", admin, async (req, reply) => {
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

  // DELETE /api/admin/horarios/:id
  app.delete("/:id", admin, async (req, reply) => {
    await query(`DELETE FROM horarios WHERE id_horario = $1`, [req.params.id]);
    return { message: "Horario eliminado" };
  });
}
