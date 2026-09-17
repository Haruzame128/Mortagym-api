import { query } from "../../config/database.js";

export default async function ejerciciosRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso("ejercicios.ver")] };
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso("ejercicios.gestionar")] };

  // GET /api/admin/ejercicios
  app.get("/", ver, async () => {
    const { rows } = await query(
      `SELECT e.id_ejercicio, e.nombre_e, e.id_categoria, c.nombre_categoria AS categoria_e
       FROM ejercicios e
       JOIN categorias_ejercicio c ON c.id_categoria = e.id_categoria
       ORDER BY c.nombre_categoria, e.nombre_e`
    );
    return rows;
  });

  // POST /api/admin/ejercicios
  app.post(
    "/",
    {
      ...gestionar,
      schema: {
        body: {
          type: "object",
          required: ["nombre", "id_categoria"],
          properties: {
            nombre:       { type: "string" },
            id_categoria: { type: "integer" },
          },
        },
      },
    },
    async (req, reply) => {
      const { nombre, id_categoria } = req.body;
      const { rows } = await query(
        `INSERT INTO ejercicios (nombre_e, id_categoria) VALUES ($1, $2) RETURNING *`,
        [nombre, id_categoria],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  // PUT /api/admin/ejercicios/:id
  app.put("/:id", gestionar, async (req, reply) => {
    const { nombre, id_categoria } = req.body;
    const { rows } = await query(
      `UPDATE ejercicios SET
        nombre_e     = COALESCE($1, nombre_e),
        id_categoria = COALESCE($2, id_categoria)
       WHERE id_ejercicio = $3 RETURNING *`,
      [nombre, id_categoria, req.params.id],
    );
    if (!rows[0])
      return reply.code(404).send({ error: "Ejercicio no encontrado" });
    return rows[0];
  });

  // DELETE /api/admin/ejercicios/:id
  app.delete("/:id", gestionar, async (req, reply) => {
    try {
      await query("DELETE FROM ejercicios WHERE id_ejercicio = $1", [req.params.id]);
      return { message: "Ejercicio eliminado" };
    } catch (err) {
      if (err.code === "23503")
        return reply.code(409).send({ error: "No se puede eliminar: el ejercicio ya está usado en rutinas existentes" });
      throw err;
    }
  });
}
