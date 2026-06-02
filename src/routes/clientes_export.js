// src/routes/clientes_export.js
import { query } from '../config/database.js'

export default async function clientesExportRoutes(app) {

  app.get('/exportar-huellas', async (_req, reply) => {
    const { rows } = await query(`
      SELECT c.id_cliente  AS id,
             c.nomap_c     AS nombre,
             u.dni_u       AS dni,
             c.huella_c    AS template_huella
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE c.activo_c = true
        AND u.activo_u = true
        AND c.huella_c IS NOT NULL
        AND c.huella_c <> ''
      ORDER BY c.id_cliente
    `)

    return reply.send({ ok: true, total: rows.length, socios: rows })
  })
}
