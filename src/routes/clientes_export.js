// src/routes/clientes_export.js
import { query } from '../config/database.js'

// Este endpoint expone las plantillas de huella (pueden ser varias por
// cliente) y el PIN alternativo, para que el agente local las sincronice y
// pueda identificar offline. Se protege con una clave compartida (distinta
// de la que usa el resto de la app) para que nadie más en la red pueda
// descargar el padrón. Si no hay clave configurada, no se exige (para no
// romper el desarrollo local).
const verificarClaveAgente = (req, reply, done) => {
  const clave = process.env.AGENT_API_KEY
  if (!clave) return done()
  if (req.headers['x-agent-key'] !== clave) {
    return reply.code(401).send({ error: 'Clave de agente inválida' })
  }
  done()
}

export default async function clientesExportRoutes(app) {

  app.get('/exportar-huellas', { preHandler: verificarClaveAgente }, async (_req, reply) => {
    const { rows } = await query(`
      SELECT c.id_cliente  AS id,
             c.nomap_c     AS nombre,
             u.dni_u       AS dni,
             c.pin_acceso_c AS pin,
             COALESCE(
               (SELECT json_agg(json_build_object('id_huella', hc.id_huella, 'template_huella', hc.template_huella))
                FROM huellas_cliente hc WHERE hc.id_cliente = c.id_cliente),
               '[]'::json
             ) AS huellas
      FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE c.activo_c = true
        AND u.activo_u = true
        AND (
          c.pin_acceso_c IS NOT NULL
          OR EXISTS (SELECT 1 FROM huellas_cliente hc WHERE hc.id_cliente = c.id_cliente)
        )
      ORDER BY c.id_cliente
    `)

    return reply.send({ ok: true, total: rows.length, socios: rows })
  })
}
