import { query } from "../../config/database.js";

export default async function categoriasEjercicioRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso("ejercicios.ver")] };
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso("ejercicios.gestionar")] };

  // GET /api/admin/categorias-ejercicio
  app.get("/", ver, async () => {
    const { rows } = await query(
      `SELECT id_categoria, nombre_categoria
       FROM categorias_ejercicio
       ORDER BY nombre_categoria`
    );
    return rows;
  });

  // POST /api/admin/categorias-ejercicio
  app.post(
    "/",
    {
      ...gestionar,
      schema: {
        body: {
          type: "object",
          required: ["nombre"],
          properties: { nombre: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      try {
        const { rows } = await query(
          `INSERT INTO categorias_ejercicio (nombre_categoria) VALUES ($1) RETURNING *`,
          [req.body.nombre],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        if (err.code === "23505")
          return reply.code(409).send({ error: "Ya existe una categoría con ese nombre" });
        throw err;
      }
    },
  );

  // DELETE /api/admin/categorias-ejercicio/:id
  app.delete("/:id", gestionar, async (req, reply) => {
    try {
      await query("DELETE FROM categorias_ejercicio WHERE id_categoria = $1", [req.params.id]);
      return { message: "Categoría eliminada" };
    } catch (err) {
      if (err.code === "23503")
        return reply.code(409).send({ error: "No se puede eliminar: hay ejercicios en esta categoría" });
      throw err;
    }
  });
}
