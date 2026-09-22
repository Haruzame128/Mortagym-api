import { query, pool } from '../../config/database.js'
import { validarCondiciones, ContratoError } from '../../services/contratos.js'

export default async function contratosRoutes(app) {
  const admin = { preHandler: [app.authenticate, app.authorize('Administrador')] }

  // PATCH /api/admin/contratos/:id — editar observaciones y/o reemplazar condiciones
  app.patch('/:id', admin, async (req, reply) => {
    const { observaciones, condiciones } = req.body
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: [existe] } = await client.query(
        `SELECT id_contrato FROM contratos_profesor WHERE id_contrato = $1`,
        [req.params.id]
      )
      if (!existe) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Contrato no encontrado' })
      }

      if (observaciones !== undefined) {
        await client.query(
          `UPDATE contratos_profesor SET observaciones = $1 WHERE id_contrato = $2`,
          [observaciones, req.params.id]
        )
      }

      if (condiciones !== undefined) {
        validarCondiciones(condiciones)
        await client.query(`DELETE FROM contrato_condiciones WHERE id_contrato = $1`, [req.params.id])
        for (const c of condiciones) {
          await client.query(
            `INSERT INTO contrato_condiciones (id_contrato, id_disciplina, modalidad, valor)
             VALUES ($1, $2, $3, $4)`,
            [req.params.id, c.id_disciplina, c.modalidad, c.valor]
          )
        }
      }

      const { rows: [contrato] } = await client.query(
        `SELECT * FROM contratos_profesor WHERE id_contrato = $1`,
        [req.params.id]
      )

      await client.query('COMMIT')
      return contrato
    } catch (e) {
      await client.query('ROLLBACK')
      if (e instanceof ContratoError) return reply.code(e.statusCode).send({ error: e.message })
      throw e
    } finally {
      client.release()
    }
  })

  // POST /api/admin/contratos/:id/rescindir — baja manual
  app.post('/:id/rescindir', {
    ...admin,
    schema: {
      body: {
        type: 'object',
        required: ['motivo'],
        properties: {
          motivo: { type: 'string', minLength: 1 },
          fecha_baja: { type: 'string', format: 'date' },
        }
      }
    }
  }, async (req, reply) => {
    const { motivo, fecha_baja } = req.body

    const { rows: [contrato] } = await query(
      `SELECT id_profesor FROM contratos_profesor WHERE id_contrato = $1`,
      [req.params.id]
    )
    if (!contrato) return reply.code(404).send({ error: 'Contrato no encontrado' })

    // Bloquear la baja mientras el profesor tenga horarios asignados en la grilla
    const { rows: horarios } = await query(`
      SELECT h.id_horario, h.dia_h, h.hora_h, a.nombre_a, d.nombre_d
      FROM horarios h
      JOIN actividades a ON a.id_actividad = h.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      WHERE h.id_profesor = $1
      ORDER BY d.nombre_d, a.nombre_a
    `, [contrato.id_profesor])

    if (horarios.length > 0) {
      return reply.code(409).send({
        error: 'El profesor todavía tiene horarios asignados. Reasigná o quitá esos horarios antes de dar de baja el contrato.',
        horarios
      })
    }

    try {
      const { rows: [resultado] } = await query(
        `SELECT rescindir_contrato_profesor($1, $2, $3, $4) AS id_contrato`,
        [contrato.id_profesor, motivo, req.user.id, fecha_baja || new Date().toISOString().slice(0, 10)]
      )
      return { id_contrato: resultado.id_contrato, message: 'Contrato rescindido correctamente' }
    } catch (e) {
      if (e.message?.includes('no tiene un contrato vigente')) {
        return reply.code(409).send({ error: e.message })
      }
      throw e
    }
  })

  // GET /api/admin/contratos/por-vencer?dias=30
  app.get('/por-vencer', admin, async (req, reply) => {
    const dias = Number(req.query.dias) || 30
    const { rows } = await query(`
      SELECT * FROM v_profesores_contrato
      WHERE estado = 'vigente' AND dias_para_vencer IS NOT NULL AND dias_para_vencer <= $1
      ORDER BY dias_para_vencer ASC
    `, [dias])
    return rows
  })
}
