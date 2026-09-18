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
  // Borra la categoría junto con todos sus ejercicios (cascada). Si alguno
  // de esos ejercicios ya está usado en una rutina, no se puede borrar sin
  // perder ese historial: se desactiva en su lugar y, como sigue "adentro"
  // de la categoría, la categoría no se termina de borrar.
  app.delete("/:id", gestionar, async (req, reply) => {
    const { rows: ejercicios } = await query(
      "SELECT id_ejercicio FROM ejercicios WHERE id_categoria = $1",
      [req.params.id],
    );

    let eliminados = 0;
    let desactivados = 0;
    for (const { id_ejercicio } of ejercicios) {
      try {
        await query("DELETE FROM ejercicios WHERE id_ejercicio = $1", [id_ejercicio]);
        eliminados++;
      } catch (err) {
        if (err.code !== "23503") throw err;
        await query("UPDATE ejercicios SET activo_e = false WHERE id_ejercicio = $1", [id_ejercicio]);
        desactivados++;
      }
    }

    if (desactivados > 0) {
      return reply.code(409).send({
        error:
          `No se pudo eliminar la categoría: ${desactivados} ejercicio(s) están usados en rutinas ` +
          `existentes y se desactivaron en su lugar (dejaron de aparecer para rutinas nuevas). ` +
          `La categoría se mantiene porque todavía los contiene.` +
          (eliminados > 0 ? ` Los otros ${eliminados} ejercicio(s) sí se eliminaron.` : ""),
        eliminados,
        desactivados,
      });
    }

    await query("DELETE FROM categorias_ejercicio WHERE id_categoria = $1", [req.params.id]);
    return { message: `Categoría eliminada junto con ${eliminados} ejercicio(s)`, eliminados };
  });
}
