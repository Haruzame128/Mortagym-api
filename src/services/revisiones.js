import { query } from "../config/database.js";

// Usada tanto por /api/medico/revisiones como por /api/admin/revisiones:
// misma data, distinto rol autorizado.
export async function listarRevisiones({ pendientes, buscar } = {}) {
  const condiciones = [];
  const params = [];

  if (pendientes === "true" || pendientes === true) {
    condiciones.push("al_dia = false");
  }
  if (buscar) {
    params.push(`%${buscar}%`);
    condiciones.push(`(nomap_c ILIKE $${params.length} OR dni_u::text ILIKE $${params.length})`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM v_revisiones_estado
     ${where}
     ORDER BY al_dia ASC, ultima_revision ASC NULLS FIRST, nomap_c ASC`,
    params,
  );

  // al_dia es boolean en la vista, pero el driver puede entregarlo como
  // string según cómo se resuelva la expresión — se fuerza acá para que
  // el frontend no tenga que adivinar.
  return rows.map((r) => ({ ...r, al_dia: r.al_dia === true || r.al_dia === "true" }));
}
