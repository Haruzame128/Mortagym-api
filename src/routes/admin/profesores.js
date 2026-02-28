import bcrypt from "bcrypt";
import { query, pool } from "../../config/database.js";

export default async function profesoresRoutes(app) {
  const admin = {
    preHandler: [app.authenticate, app.authorize("Administrador")],
  };

  // GET /api/admin/profesores
  // Devuelve lista de profesores con DNI y actividades asignadas (si las hay)
  app.get("/", admin, async () => {
    const { rows } = await query(`
    SELECT p.id_profesor, p.nomap_p, p.activo_p, p.porcentaje_p,
           u.dni_u,
           ARRAY_AGG(a.nombre_a) FILTER (WHERE a.id_actividad IS NOT NULL) AS actividades
    FROM profesores p
    JOIN usuarios u ON u.id_usuario = p.id_usuario
    LEFT JOIN actividades a ON a.id_profesor = p.id_profesor
    GROUP BY p.id_profesor, p.nomap_p, p.activo_p, p.porcentaje_p, u.dni_u
    ORDER BY p.nomap_p
  `);
    return rows;
  });

  // GET /api/admin/profesores/:id — con actividades asignadas
  // Devuelve datos del profesor + lista de actividades asignadas (con disciplina y cantidad de horarios)
  app.get("/:id", admin, async (req, reply) => {
    const { rows } = await query(
      `
      SELECT p.*, u.dni_u, u.activo_u
      FROM profesores p JOIN usuarios u ON u.id_usuario = p.id_usuario
      WHERE p.id_profesor = $1
    `,
      [req.params.id],
    );
    if (!rows[0])
      return reply.code(404).send({ error: "Profesor no encontrado" });

    const { rows: actividades } = await query(
      `
      SELECT a.id_actividad, a.nombre_a, d.nombre_d,
             COUNT(h.id_horario) AS horarios
      FROM actividades a
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN horarios h ON h.id_actividad = a.id_actividad
      WHERE a.id_profesor = $1
      GROUP BY a.id_actividad, a.nombre_a, d.nombre_d
    `,
      [req.params.id],
    );

    return { ...rows[0], actividades };
  });

  // POST /api/admin/profesores — crea Usuario + Profesor en transacción
  // crea un nuevo profesor con su usuario asociado. El DNI debe ser único. La contraseña se guarda hasheada.
  app.post(
    "/",
    {
      ...admin,
      schema: {
        body: {
          type: "object",
          required: ["dni", "contrasena", "nombre_apellido"],
          properties: {
            dni: { type: "integer" },
            contrasena: { type: "string", minLength: 4 },
            nombre_apellido: { type: "string" },
            porcentaje: { type: "integer", default: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const { dni, contrasena, nombre_apellido, porcentaje = 0 } = req.body;
      const hash = await bcrypt.hash(contrasena, 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const {
          rows: [usuario],
        } = await client.query(
          `INSERT INTO usuarios (dni_u, password_u, rol_u, activo_u)
         VALUES ($1, $2, 'Profesor', true) RETURNING id_usuario`,
          [dni, hash],
        );
        const {
          rows: [prof],
        } = await client.query(
          `INSERT INTO profesores (id_usuario, nomap_p, huella_p, activo_p, porcentaje_p)
         VALUES ($1, $2, '', true, $3) RETURNING id_profesor`,
          [usuario.id_usuario, nombre_apellido, porcentaje],
        );
        await client.query("COMMIT");
        return reply.code(201).send({
          id_usuario: usuario.id_usuario,
          id_profesor: prof.id_profesor,
          nombre_apellido,
          dni,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        if (e.code === "23505")
          return reply.code(409).send({ error: "El DNI ya está registrado" });
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // PUT /api/admin/profesores/:id
  // Actualiza datos del profesor. Solo campos enviados en el body. No se puede cambiar el DNI ni la contraseña por esta ruta.
  app.put("/:id", admin, async (req, reply) => {
    const { nombre_apellido, porcentaje, activo } = req.body;
    const { rows } = await query(
      `UPDATE profesores SET
        nomap_p      = COALESCE($1, nomap_p),
        porcentaje_p = COALESCE($2, porcentaje_p),
        activo_p     = COALESCE($3, activo_p)
       WHERE id_profesor = $4 RETURNING *`,
      [nombre_apellido, porcentaje, activo, req.params.id],
    );
    if (!rows[0])
      return reply.code(404).send({ error: "Profesor no encontrado" });
    return rows[0];
  });
}
