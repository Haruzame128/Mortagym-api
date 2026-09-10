import { query } from "../config/database.js";
import { listarRevisiones } from "../services/revisiones.js";

const MEDIOS_PAGO = ["Efectivo", "Debito", "Transferencia", "Credito", "Otro"];
const RESULTADOS = ["apto", "apto_con_observaciones", "no_apto"];

export default async function medicoRoutes(app) {
  const medico = { preHandler: [app.authenticate, app.authorize("Medico")] };

  // GET /api/medico/revisiones?pendientes=true&buscar=texto
  app.get("/revisiones", medico, async (req) => {
    return listarRevisiones(req.query);
  });

  // POST /api/medico/revisiones
  // El monto sale del precio vigente (vía registrar_revision) y el
  // id_usuario_medico sale del JWT: nunca se aceptan desde el body.
  app.post(
    "/revisiones",
    {
      ...medico,
      schema: {
        body: {
          type: "object",
          required: ["id_cliente"],
          properties: {
            id_cliente:    { type: "integer" },
            medio_pago:    { type: "string", enum: MEDIOS_PAGO },
            resultado:     { type: "string", enum: RESULTADOS },
            observaciones: { type: ["string", "null"] },
          },
        },
      },
    },
    async (req, reply) => {
      const { id_cliente, medio_pago, resultado, observaciones } = req.body;
      try {
        const { rows: [{ registrar_revision: id_revision }] } = await query(
          `SELECT registrar_revision($1, $2, $3, $4, $5) AS registrar_revision`,
          [id_cliente, req.user.id, medio_pago || "Efectivo", resultado || "apto", observaciones || null],
        );

        if (resultado === "no_apto") {
          app.log.warn(
            { id_cliente, id_revision, id_usuario_medico: req.user.id },
            "Revisación registrada con resultado NO APTO",
          );
        }

        return reply.code(201).send({ id_revision });
      } catch (e) {
        if (e.code === "23505") {
          return reply.code(409).send({ error: "Este cliente ya tiene una revisación registrada este mes" });
        }
        throw e;
      }
    },
  );

  // GET /api/medico/clientes/:id/historial
  app.get("/clientes/:id/historial", medico, async (req) => {
    const { rows } = await query(
      `SELECT id_revision, periodo, fecha_revision, resultado, observaciones,
              monto, medio_pago, creado_en
       FROM revisaciones_medicas
       WHERE id_cliente = $1
       ORDER BY periodo DESC`,
      [req.params.id],
    );
    return rows;
  });
}
