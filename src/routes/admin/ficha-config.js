import { query } from '../../config/database.js'

export default async function fichaConfigRoutes(app) {
  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }
  // Recepción también genera la ficha en PDF (alta de socios), así que
  // necesita poder leer estos datos aunque no pueda editarlos.
  const ver = { preHandler: [app.authenticate, app.authorize('Administrador', 'Recepcion')] }

  // GET /api/admin/ficha-config
  app.get('/', ver, async () => {
    const { rows: [config] } = await query(
      `SELECT nombre_gimnasio, direccion, cuit, condiciones, actualizado_en
       FROM ficha_inscripcion_config WHERE id = 1`
    )
    return config
  })

  // PUT /api/admin/ficha-config
  app.put(
    '/',
    {
      ...admin,
      schema: {
        body: {
          type: 'object',
          required: ['nombre_gimnasio', 'direccion', 'cuit', 'condiciones'],
          properties: {
            nombre_gimnasio: { type: 'string', minLength: 1 },
            direccion: { type: 'string', minLength: 1 },
            cuit: { type: 'string', minLength: 1 },
            condiciones: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req) => {
      const { nombre_gimnasio, direccion, cuit, condiciones } = req.body
      const { rows: [config] } = await query(
        `UPDATE ficha_inscripcion_config
         SET nombre_gimnasio = $1, direccion = $2, cuit = $3, condiciones = $4, actualizado_en = now()
         WHERE id = 1
         RETURNING nombre_gimnasio, direccion, cuit, condiciones, actualizado_en`,
        [nombre_gimnasio, direccion, cuit, condiciones]
      )
      return config
    }
  )
}
