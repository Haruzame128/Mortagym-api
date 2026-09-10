import { query } from "../../config/database.js";
import { listarRevisiones } from "../../services/revisiones.js";

export default async function revisionesRoutes(app) {
  const admin = { preHandler: [app.authenticate, app.authorize("Administrador")] };
  const ver = { preHandler: [app.authenticate, app.requierePermiso("revisaciones.ver")] };

  // GET /api/admin/revisiones?pendientes=true&buscar=texto
  // Mismo dato que ve la doctora; Administrador y Recepción lo necesitan
  // para saber a quién le falta la revisación, sin la restricción de rol de /medico/*.
  app.get("/", ver, async (req) => {
    return listarRevisiones(req.query);
  });

  // GET /api/admin/revisiones/precio — precio vigente + historial.
  // El monto que ve la doctora (revision_precio) lo fija el admin acá,
  // nunca la persona que hace la revisación.
  app.get("/precio", admin, async () => {
    const { rows: historial } = await query(
      `SELECT id_precio_revision, monto, vigente_desde, creado_en
       FROM revision_precio
       ORDER BY vigente_desde DESC, id_precio_revision DESC`,
    );
    // Misma condición que usa registrar_revision() para elegir el precio real.
    const { rows: [vigente] } = await query(
      `SELECT id_precio_revision, monto, vigente_desde
       FROM revision_precio
       WHERE vigente_desde <= CURRENT_DATE
       ORDER BY vigente_desde DESC, id_precio_revision DESC
       LIMIT 1`,
    );
    return { vigente: vigente || null, historial };
  });

  // POST /api/admin/revisiones/precio
  // Si ya existe un precio cargado para esa fecha (por defecto, hoy) lo
  // corrige en lugar de duplicarlo; fechas anteriores quedan como historial
  // y no se tocan, así lo ya cobrado nunca cambia.
  app.post(
    "/precio",
    {
      ...admin,
      schema: {
        body: {
          type: "object",
          required: ["monto"],
          properties: {
            monto: { type: "number", exclusiveMinimum: 0 },
            vigente_desde: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { monto, vigente_desde } = req.body;
      const { rows: [existente] } = await query(
        `SELECT id_precio_revision FROM revision_precio WHERE vigente_desde = COALESCE($1, CURRENT_DATE)`,
        [vigente_desde || null],
      );

      const { rows: [row] } = existente
        ? await query(
            `UPDATE revision_precio SET monto = $1 WHERE id_precio_revision = $2
             RETURNING id_precio_revision, monto, vigente_desde, creado_en`,
            [monto, existente.id_precio_revision],
          )
        : await query(
            `INSERT INTO revision_precio (monto, vigente_desde)
             VALUES ($1, COALESCE($2, CURRENT_DATE))
             RETURNING id_precio_revision, monto, vigente_desde, creado_en`,
            [monto, vigente_desde || null],
          );

      return reply.code(201).send(row);
    },
  );
}
