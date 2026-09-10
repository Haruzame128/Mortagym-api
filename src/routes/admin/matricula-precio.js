import { query } from '../../config/database.js'

export default async function matriculaPrecioRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso('precios.ver')] }
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso('precios.gestionar')] }

  // GET /api/admin/matricula-precio?disciplina=6&anio=2026
  app.get('/', ver, async (req) => {
    const { disciplina, anio } = req.query
    const condiciones = []
    const params = []

    if (disciplina) {
      params.push(Number(disciplina))
      condiciones.push(`mp.id_disciplina = $${params.length}`)
    }
    if (anio) {
      params.push(Number(anio))
      condiciones.push(`mp.anio = $${params.length}`)
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''
    const { rows } = await query(
      `
      SELECT mp.id_matricula_precio, mp.id_disciplina, d.nombre_d, mp.anio,
             mp.monto_1, mp.monto_2, mp.monto_3, mp.monto_4, mp.monto_5, mp.monto_6
      FROM matricula_precio mp
      JOIN disciplinas d ON d.id_disciplina = mp.id_disciplina
      ${where}
      ORDER BY mp.anio DESC, d.nombre_d
      `,
      params,
    )
    return rows
  })

  // POST /api/admin/matricula-precio — fija/actualiza el precio del año,
  // uno por cada cantidad de días/semana (varía según cuántas veces por
  // semana asiste el cliente a esa disciplina).
  app.post(
    '/',
    {
      ...gestionar,
      schema: {
        body: {
          type: 'object',
          required: ['id_disciplina', 'anio'],
          properties: {
            id_disciplina: { type: 'integer' },
            anio: { type: 'integer' },
            monto_1: { type: 'number', minimum: 0 },
            monto_2: { type: 'number', minimum: 0 },
            monto_3: { type: 'number', minimum: 0 },
            monto_4: { type: 'number', minimum: 0 },
            monto_5: { type: 'number', minimum: 0 },
            monto_6: { type: 'number', minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const { id_disciplina, anio, monto_1, monto_2, monto_3, monto_4, monto_5, monto_6 } = req.body
      const {
        rows: [row],
      } = await query(
        `
        INSERT INTO matricula_precio (id_disciplina, anio, monto_1, monto_2, monto_3, monto_4, monto_5, monto_6)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id_disciplina, anio) DO UPDATE SET
          monto_1 = COALESCE(EXCLUDED.monto_1, matricula_precio.monto_1),
          monto_2 = COALESCE(EXCLUDED.monto_2, matricula_precio.monto_2),
          monto_3 = COALESCE(EXCLUDED.monto_3, matricula_precio.monto_3),
          monto_4 = COALESCE(EXCLUDED.monto_4, matricula_precio.monto_4),
          monto_5 = COALESCE(EXCLUDED.monto_5, matricula_precio.monto_5),
          monto_6 = COALESCE(EXCLUDED.monto_6, matricula_precio.monto_6)
        RETURNING id_matricula_precio, id_disciplina, anio, monto_1, monto_2, monto_3, monto_4, monto_5, monto_6
        `,
        [id_disciplina, anio, monto_1 ?? null, monto_2 ?? null, monto_3 ?? null, monto_4 ?? null, monto_5 ?? null, monto_6 ?? null],
      )
      return reply.code(201).send(row)
    },
  )
}
