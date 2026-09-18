import { query } from "../../config/database.js";

export default async function ejerciciosRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso("ejercicios.ver")] };
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso("ejercicios.gestionar")] };

  // GET /api/admin/ejercicios
  app.get("/", ver, async () => {
    const { rows } = await query(
      `SELECT e.id_ejercicio, e.nombre_e, e.id_categoria, e.activo_e, c.nombre_categoria AS categoria_e
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

  // PUT /api/admin/ejercicios/:id/activo
  app.put("/:id/activo", gestionar, async (req, reply) => {
    const { activo } = req.body;
    if (activo === undefined)
      return reply.code(400).send({ error: "activo es requerido" });
    const { rows: [e] } = await query(
      `UPDATE ejercicios SET activo_e = $1 WHERE id_ejercicio = $2 RETURNING activo_e`,
      [activo, req.params.id],
    );
    if (!e) return reply.code(404).send({ error: "Ejercicio no encontrado" });
    return { activo_e: e.activo_e };
  });

  // DELETE /api/admin/ejercicios/:id
  // Si el ejercicio ya está usado en alguna rutina, no se puede borrar sin
  // perder ese historial (FK RESTRICT) — en ese caso se desactiva en vez de
  // eliminarse: deja de aparecer para rutinas nuevas pero no toca lo cargado.
  app.delete("/:id", gestionar, async (req, reply) => {
    try {
      await query("DELETE FROM ejercicios WHERE id_ejercicio = $1", [req.params.id]);
      return { message: "Ejercicio eliminado", eliminado: true };
    } catch (err) {
      if (err.code !== "23503") throw err;
      await query("UPDATE ejercicios SET activo_e = false WHERE id_ejercicio = $1", [req.params.id]);
      return {
        message: "El ejercicio está usado en rutinas existentes: se desactivó en vez de eliminarse",
        eliminado: false,
        desactivado: true,
      };
    }
  });
}
