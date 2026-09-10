import { query } from "../config/database.js";
import { createWriteStream, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, "..", "..", "uploads", "planes_nutricion");
mkdirSync(UPLOADS_DIR, { recursive: true });

export default async function nutricionRoutes(app) {
  const nutricionista = { preHandler: [app.authenticate, app.authorize("Nutricionista")] };

  // GET /api/nutricion/clientes?buscar=texto
  app.get("/clientes", nutricionista, async (req) => {
    const { buscar } = req.query;
    const condiciones = [];
    const params = [];

    if (buscar) {
      params.push(`%${buscar}%`);
      condiciones.push(`(nomap_c ILIKE $${params.length} OR dni_u::text ILIKE $${params.length})`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const { rows } = await query(
      `SELECT * FROM v_planes_nutricion_estado ${where} ORDER BY tiene_plan ASC, nomap_c ASC`,
      params,
    );
    return rows.map((r) => ({ ...r, tiene_plan: r.tiene_plan === true || r.tiene_plan === "true" }));
  });

  // POST /api/nutricion/planes — multipart: id_cliente + pdf (+ observaciones opcional)
  app.post("/planes", nutricionista, async (req, reply) => {
    const parts = req.parts();
    let id_cliente = null;
    let observaciones = null;
    let archivo_pdf = null;
    let nombre_original = null;

    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "pdf") {
        if (part.mimetype !== "application/pdf") {
          return reply.code(400).send({ error: "El archivo debe ser un PDF" });
        }
        const filename = `${randomUUID()}.pdf`;
        await pipeline(part.file, createWriteStream(join(UPLOADS_DIR, filename)));
        archivo_pdf = `/uploads/planes_nutricion/${filename}`;
        nombre_original = part.filename;
      } else {
        if (part.fieldname === "id_cliente") id_cliente = Number(part.value);
        if (part.fieldname === "observaciones") observaciones = part.value || null;
      }
    }

    if (!id_cliente) return reply.code(400).send({ error: "id_cliente es requerido" });
    if (!archivo_pdf) return reply.code(400).send({ error: "El PDF es requerido" });

    const {
      rows: [plan],
    } = await query(
      `INSERT INTO planes_nutricion (id_cliente, id_usuario_nutricionista, archivo_pdf, nombre_original, observaciones)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id_cliente, req.user.id, archivo_pdf, nombre_original, observaciones],
    );
    return reply.code(201).send(plan);
  });

  // GET /api/nutricion/clientes/:id/historial
  app.get("/clientes/:id/historial", nutricionista, async (req) => {
    const { rows } = await query(
      `SELECT id_plan, archivo_pdf, nombre_original, observaciones, creado_en
       FROM planes_nutricion
       WHERE id_cliente = $1
       ORDER BY creado_en DESC`,
      [req.params.id],
    );
    return rows;
  });
}
