import { query, pool } from "../config/database.js";

export default async function profesorRoutes(app) {
  const profesor = {
    preHandler: [app.authenticate, app.authorize("Profesor")],
  };

  const getIdProfesor = async (id_usuario) => {
    const {
      rows: [p],
    } = await query(
      `SELECT id_profesor FROM profesores WHERE id_usuario = $1`,
      [id_usuario],
    );
    return p?.id_profesor || null;
  };

  // GET /api/profesor/alumnos
  app.get("/alumnos", profesor, async (req, reply) => {
    const id_profesor = await getIdProfesor(req.user.id);
    if (!id_profesor)
      return reply.code(404).send({ error: "Profesor no encontrado" });

    const { rows } = await query(
      `
      SELECT DISTINCT
             c.id_cliente, c.nomap_c, d.nombre_d,
             h.dia_h, h.hora_h, s.cantidad_dias,
             EXISTS(
               SELECT 1 FROM cronograma cr
               WHERE cr.id_cliente = c.id_cliente AND cr.id_profesor = $1
             ) AS tiene_rutina,
             COALESCE(
               (SELECT STRING_AGG(pat, ', ')
                FROM (
                  SELECT CASE WHEN fm2.patologia_columna THEN 'Patología columna' END AS pat FROM ficha_medica fm2 WHERE fm2.id_cliente = c.id_cliente AND fm2.patologia_columna
                  UNION ALL
                  SELECT CASE WHEN fm2.enf_cardiaca THEN 'Enf. cardíaca' END FROM ficha_medica fm2 WHERE fm2.id_cliente = c.id_cliente AND fm2.enf_cardiaca
                  UNION ALL
                  SELECT CASE WHEN fm2.lesiones THEN 'Lesiones' END FROM ficha_medica fm2 WHERE fm2.id_cliente = c.id_cliente AND fm2.lesiones
                ) patologias_sub WHERE pat IS NOT NULL),
               'Sin patologías'
             ) AS patologias
      FROM profesores p
      JOIN horarios h    ON h.id_profesor  = p.id_profesor
      JOIN actividades a ON a.id_actividad = h.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      JOIN inscripcion i ON i.id_actividad = a.id_actividad AND i.id_horario = h.id_horario
      JOIN clientes c    ON c.id_cliente   = i.id_cliente
      LEFT JOIN suscripciones s ON s.id_inscripto = i.id_inscripto
      WHERE p.id_profesor = $1 AND c.activo_c = true
      ORDER BY c.nomap_c
    `,
      [id_profesor],
    );

    return rows;
  });

  // GET /api/profesor/ejercicios
  app.get("/ejercicios", profesor, async () => {
    const { rows } = await query(`
      SELECT e.id_ejercicio, e.nombre_e, c.nombre_categoria AS categoria_e
      FROM ejercicios e
      JOIN categorias_ejercicio c ON c.id_categoria = e.id_categoria
      ORDER BY c.nombre_categoria, e.nombre_e
    `);
    return rows;
  });

  // GET /api/profesor/alumnos/:id_cliente/rutina?mes=Julio&semana=1
  app.get("/alumnos/:id_cliente/rutina", profesor, async (req, reply) => {
    const id_profesor = await getIdProfesor(req.user.id);
    if (!id_profesor)
      return reply.code(404).send({ error: "Profesor no encontrado" });

    const { id_cliente } = req.params;
    const { mes, semana } = req.query;

    const params = [id_cliente, id_profesor];
    let where = "WHERE cr.id_cliente = $1 AND cr.id_profesor = $2";
    if (mes) {
      params.push(mes);
      where += ` AND cr.mes_c = $${params.length}`;
    }
    if (semana) {
      params.push(semana);
      where += ` AND cr.semana_c = $${params.length}`;
    }

    const { rows } = await query(
      `
      SELECT cr.id_cronograma, cr.semana_c, cr.mes_c,
             r.id_rutina, r.dia_r, r.series_r, r.repeticiones_r, r.peso_r,
             e.id_ejercicio, e.nombre_e, cat.nombre_categoria AS categoria_e,
             p.series_cliente, p.repeticion_cliente, p.peso_cliente, p.fecha AS fecha_progreso
      FROM cronograma cr
      JOIN rutinas r     ON r.id_rutina    = cr.id_rutina
      JOIN ejercicios e  ON e.id_ejercicio = r.id_ejercicio
      JOIN categorias_ejercicio cat ON cat.id_categoria = e.id_categoria
      LEFT JOIN progreso p ON p.id_rutina = r.id_rutina AND p.semana_p = cr.semana_c
      ${where}
      ORDER BY cr.semana_c, r.dia_r, cat.nombre_categoria, e.nombre_e
    `,
      params,
    );

    return rows;
  });

  // POST /api/profesor/rutinas — guarda rutina para un alumno/mes/semana
  app.post(
    "/rutinas",
    {
      ...profesor,
      schema: {
        body: {
          type: "object",
          required: ["id_cliente", "mes", "dias"],
          properties: {
            id_cliente: { type: "integer" },
            mes: { type: "string" },
            semana: { type: "integer" },
            dias: { type: "array" },
          },
        },
      },
    },
    async (req, reply) => {
      const { id_cliente, mes, semana = 1, dias } = req.body;
      const id_profesor = await getIdProfesor(req.user.id);
      if (!id_profesor)
        return reply.code(404).send({ error: "Profesor no encontrado" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Borrar rutina anterior para ese cliente/profesor/mes/semana
        const { rows: anteriores } = await client.query(
          `SELECT c.id_cronograma, c.id_rutina FROM cronograma c
         WHERE c.id_cliente = $1 AND c.id_profesor = $2 AND c.mes_c = $3 AND c.semana_c = $4`,
          [id_cliente, id_profesor, mes, semana],
        );
        for (const ant of anteriores) {
          await client.query(
            `DELETE FROM cronograma WHERE id_cronograma = $1`,
            [ant.id_cronograma],
          );
          await client.query(`DELETE FROM rutinas WHERE id_rutina = $1`, [
            ant.id_rutina,
          ]);
        }

        // Insertar nuevas rutinas + cronograma
        for (const dia of dias) {
          for (const ej of dia.ejercicios) {
            if (!ej.id_ejercicio) continue;
            const {
              rows: [rutina],
            } = await client.query(
              `INSERT INTO rutinas (dia_r, id_ejercicio, series_r, repeticiones_r, peso_r)
             VALUES ($1, $2, $3, $4, $5) RETURNING id_rutina`,
              [
                dia.dia,
                ej.id_ejercicio,
                ej.series || 0,
                ej.repeticiones || 0,
                ej.peso || 0,
              ],
            );
            await client.query(
              `INSERT INTO cronograma (id_cliente, id_profesor, id_rutina, mes_c, semana_c)
             VALUES ($1, $2, $3, $4, $5)`,
              [id_cliente, id_profesor, rutina.id_rutina, mes, semana],
            );
          }
        }

        await client.query("COMMIT");
        return { message: "Rutina guardada" };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  );

  app.get("/alumnos/:id_cliente/progreso", profesor, async (req, reply) => {
    const id_profesor = await getIdProfesor(req.user.id);
    if (!id_profesor)
      return reply.code(404).send({ error: "Profesor no encontrado" });

    const { id_cliente } = req.params;
    const mes = req.query.mes || "Julio";

    const { rows } = await query(
      `
    SELECT cr.semana_c, r.dia_r, e.nombre_e AS ejercicio,
           r.series_r, r.repeticiones_r, r.peso_r,
           p.series_cliente, p.repeticion_cliente, p.peso_cliente, p.fecha
    FROM cronograma cr
    JOIN rutinas r    ON r.id_rutina    = cr.id_rutina
    JOIN ejercicios e ON e.id_ejercicio = r.id_ejercicio
    LEFT JOIN progreso p ON p.id_rutina = r.id_rutina AND p.semana_p = cr.semana_c
    WHERE cr.id_cliente = $1 AND cr.id_profesor = $2 AND cr.mes_c = $3
    ORDER BY cr.semana_c, r.dia_r, e.nombre_e
  `,
      [id_cliente, id_profesor, mes],
    );

    return rows;
  });

  // GET /api/profesor/perfil
  app.get("/perfil", profesor, async (req, reply) => {
    const {
      rows: [p],
    } = await query(
      `
    SELECT pr.id_profesor, pr.nomap_p, pr.telefono_p, pr.celular_p,
           pr.mail_p, pr.direccion_p, pr.fecha_nac_p,
           u.dni_u
    FROM profesores pr
    JOIN usuarios u ON u.id_usuario = pr.id_usuario
    WHERE pr.id_usuario = $1
  `,
      [req.user.id],
    );
    if (!p) return reply.code(404).send({ error: "Profesor no encontrado" });
    return p;
  });

  // PATCH /api/profesor/perfil
  app.patch("/perfil", profesor, async (req, reply) => {
    const { telefono, celular, mail, direccion } = req.body;
    const {
      rows: [p],
    } = await query(
      `
    UPDATE profesores SET
      telefono_p  = COALESCE($1, telefono_p),
      celular_p   = COALESCE($2, celular_p),
      mail_p      = COALESCE($3, mail_p),
      direccion_p = COALESCE($4, direccion_p)
    WHERE id_usuario = $5
    RETURNING nomap_p, telefono_p, celular_p, mail_p, direccion_p, fecha_nac_p
  `,
      [
        telefono || null,
        celular || null,
        mail || null,
        direccion || null,
        req.user.id,
      ],
    );
    if (!p) return reply.code(404).send({ error: "Profesor no encontrado" });
    return { mensaje: "Datos actualizados", perfil: p };
  });
}
