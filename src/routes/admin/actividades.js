import { query } from "../../config/database.js";

export default async function actividadesRoutes(app) {
  const admin = {
    preHandler: [app.authenticate, app.authorize("Administrador")],
  };

  // GET /api/admin/actividades?disciplina=:id
  app.get("/", admin, async (req) => {
    const { disciplina } = req.query;

    const { rows } = await query(
      `
      SELECT a.id_actividad, a.nombre_a, a.descripcion_a, a.max_inasistencia,
             a.activo_a, a.tipo_a,
             d.nombre_d, d.id_disciplina, d.tipo_d,
             p.id_profesor,
             p.nomap_p AS profesor,
             MAX(h.cupo_maximo) AS cupo_maximo,
             (SELECT COUNT(*) FROM inscripcion i WHERE i.id_actividad = a.id_actividad) AS alumnos
      FROM actividades a
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN horarios h ON h.id_actividad = a.id_actividad
      LEFT JOIN profesores p ON p.id_profesor = h.id_profesor
      ${disciplina ? "WHERE a.id_disciplina = $1" : ""}
      GROUP BY a.id_actividad, a.nombre_a, a.descripcion_a, a.max_inasistencia,
               a.activo_a, a.tipo_a,
               d.nombre_d, d.id_disciplina, d.tipo_d,
               p.id_profesor, p.nomap_p
      ORDER BY a.nombre_a, p.nomap_p
      `,
      disciplina ? [disciplina] : [],
    );

    return rows;
  });

  // POST /api/admin/actividades
  app.post(
    "/",
    {
      ...admin,
      schema: {
        body: {
          type: "object",
          required: ["id_disciplina", "nombre"],
          properties: {
            id_disciplina:    { type: "integer" },
            nombre:           { type: "string" },
            descripcion:      { type: "string" },
            max_inasistencia: { type: "integer" },
            tipo_a:           { type: "string", enum: ["fijo", "variable"] },
          },
        },
      },
    },
    async (req, reply) => {
      const { id_disciplina, nombre, descripcion, max_inasistencia, tipo_a } = req.body;

      // Si la disciplina es musculacion, tipo_a default es variable
      const { rows: [disc] } = await query(
        `SELECT tipo_d FROM disciplinas WHERE id_disciplina = $1`,
        [id_disciplina]
      );
      const tipoFinal = tipo_a || (disc?.tipo_d === 'musculacion' ? 'variable' : 'fijo');

      const { rows } = await query(
        `INSERT INTO actividades (id_disciplina, nombre_a, descripcion_a, max_inasistencia, tipo_a)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id_disciplina, nombre, descripcion || null, max_inasistencia || 3, tipoFinal],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  // PUT /api/admin/actividades/:id
  app.put("/:id", admin, async (req, reply) => {
    const { nombre, descripcion, max_inasistencia, activo, tipo_a } = req.body;
    const { rows } = await query(
      `UPDATE actividades SET
        nombre_a         = COALESCE($1, nombre_a),
        descripcion_a    = COALESCE($2, descripcion_a),
        max_inasistencia = COALESCE($3, max_inasistencia),
        activo_a         = COALESCE($4, activo_a),
        tipo_a           = COALESCE($5, tipo_a)
       WHERE id_actividad = $6 RETURNING *`,
      [nombre, descripcion, max_inasistencia, activo, tipo_a, req.params.id],
    );
    if (!rows[0])
      return reply.code(404).send({ error: "Actividad no encontrada" });
    return rows[0];
  });

  // PUT /api/admin/actividades/:id/activo
  app.put("/:id/activo", admin, async (req, reply) => {
    const { activo } = req.body;
    if (activo === undefined)
      return reply.code(400).send({ error: "activo es requerido" });
    const { rows: [a] } = await query(
      `UPDATE actividades SET activo_a = $1 WHERE id_actividad = $2 RETURNING activo_a`,
      [activo, req.params.id],
    );
    if (!a) return reply.code(404).send({ error: "Actividad no encontrada" });
    return { activo_a: a.activo_a };
  });

  // DELETE /api/admin/actividades/:id
  app.delete("/:id", admin, async (req, reply) => {
    await query("DELETE FROM actividades WHERE id_actividad = $1", [req.params.id]);
    return { message: "Actividad eliminada" };
  });
}