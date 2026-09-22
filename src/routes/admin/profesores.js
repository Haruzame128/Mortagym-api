import bcrypt from "bcrypt";
import { query, pool } from "../../config/database.js";
import { crearContrato, obtenerCondiciones, ContratoError } from "../../services/contratos.js";

// Mismo criterio que ya se usa para el apto médico de clientes: vigente si
// venc_ficha_medica no pasó; pendiente si nunca se entregó pero todavía está
// dentro del mes de plazo desde el alta (acá, el primer contrato); vencido
// en cualquier otro caso.
const ESTADO_APTO_MEDICO_SQL = `
  CASE
    WHEN p.venc_ficha_medica IS NOT NULL AND p.venc_ficha_medica >= CURRENT_DATE THEN 'vigente'
    WHEN p.venc_ficha_medica IS NOT NULL AND p.venc_ficha_medica < CURRENT_DATE THEN 'vencido'
    WHEN fecha_alta.fecha IS NULL OR fecha_alta.fecha + INTERVAL '1 month' >= CURRENT_DATE THEN 'pendiente'
    ELSE 'vencido'
  END AS estado_ficha_medica
`

export default async function profesoresRoutes(app) {
  const admin = {
    preHandler: [app.authenticate, app.authorize("Administrador")],
  };

  // GET /api/admin/profesores
  // Usa v_profesores_contrato: trae el contrato vigente (si hay) y sus
  // condiciones en un solo viaje, sin N+1. porcentaje_p queda deprecado.
  app.get("/", admin, async () => {
    const { rows } = await query(`
      SELECT v.id_profesor, v.nomap_p, v.activo_p, u.dni_u,
             v.id_contrato, v.fecha_alta, v.duracion_meses, v.fecha_vencimiento,
             v.estado AS estado_contrato, v.dias_para_vencer, v.condiciones,
             p.fecha_entrega_ficha_medica, p.venc_ficha_medica,
             ${ESTADO_APTO_MEDICO_SQL}
      FROM v_profesores_contrato v
      JOIN profesores p ON p.id_profesor = v.id_profesor
      JOIN usuarios u ON u.id_usuario = p.id_usuario
      LEFT JOIN LATERAL (
        SELECT MIN(cp.fecha_alta) AS fecha
        FROM contratos_profesor cp WHERE cp.id_profesor = p.id_profesor
      ) fecha_alta ON true
      ORDER BY v.nomap_p
    `);
    return rows.map(r => ({
      ...r,
      disciplinas: (r.condiciones || []).map(c => c.disciplina),
    }));
  });

  // GET /api/admin/profesores/:id
  app.get("/:id", admin, async (req, reply) => {
    const { rows } = await query(
      `SELECT p.*, u.dni_u, u.activo_u, fecha_alta.fecha AS fecha_alta_profesor,
              ${ESTADO_APTO_MEDICO_SQL}
       FROM profesores p
       JOIN usuarios u ON u.id_usuario = p.id_usuario
       LEFT JOIN LATERAL (
         SELECT MIN(cp.fecha_alta) AS fecha
         FROM contratos_profesor cp WHERE cp.id_profesor = p.id_profesor
       ) fecha_alta ON true
       WHERE p.id_profesor = $1`,
      [req.params.id],
    );
    if (!rows[0])
      return reply.code(404).send({ error: "Profesor no encontrado" });

    const { rows: [contratoVigente] } = await query(
      `SELECT * FROM v_profesores_contrato WHERE id_profesor = $1`,
      [req.params.id],
    );

    return {
      ...rows[0],
      contrato_vigente: contratoVigente?.id_contrato ? contratoVigente : null,
    };
  });

  // PUT /api/admin/profesores/:id/apto-medico
  // Registra la entrega del certificado médico físico. El vencimiento se
  // calcula solo (un año desde la entrega). Con fecha_entrega=null se limpia.
  app.put("/:id/apto-medico", {
    ...admin,
    schema: {
      body: {
        type: "object",
        properties: {
          fecha_entrega: { type: ["string", "null"], format: "date" },
        },
      },
    },
  }, async (req, reply) => {
    const { fecha_entrega } = req.body;
    const { rows } = await query(
      `UPDATE profesores SET
         fecha_entrega_ficha_medica = $1,
         venc_ficha_medica = CASE WHEN $1::date IS NOT NULL THEN $1::date + INTERVAL '1 year' ELSE NULL END
       WHERE id_profesor = $2
       RETURNING id_profesor, fecha_entrega_ficha_medica, venc_ficha_medica`,
      [fecha_entrega || null, req.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "Profesor no encontrado" });
    return rows[0];
  });

  // POST /api/admin/profesores
  // Crea usuario + profesor + su contrato inicial (con condiciones) en una
  // sola transacción. Un profesor no puede existir sin contrato vigente.
  app.post(
    "/",
    {
      ...admin,
      schema: {
        body: {
          type: "object",
          required: ["dni", "nombre_apellido", "condiciones"],
          properties: {
            dni:             { type: "integer" },
            contrasena:      { type: "string", minLength: 4 },
            nombre_apellido: { type: "string" },
            direccion:       { type: "string" },
            telefono:        { type: "string" },
            celular:         { type: "string" },
            fecha_nac:       { type: "string" },
            mail:            { type: "string" },
            fecha_alta:      { type: "string" },
            duracion_meses:  { type: "integer" },
            observaciones:   { type: "string" },
            condiciones:     { type: "array" },
          },
        },
      },
    },
    async (req, reply) => {
      const {
        dni, contrasena, nombre_apellido,
        direccion, telefono, celular, fecha_nac, mail,
        fecha_alta, duracion_meses, observaciones, condiciones,
      } = req.body;
      const passwordPlano = contrasena || String(dni);
      const hash = await bcrypt.hash(passwordPlano, 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: [usuario] } = await client.query(
          `INSERT INTO usuarios (dni_u, password_u, rol_u, activo_u)
           VALUES ($1, $2, 'Profesor', true) RETURNING id_usuario`,
          [dni, hash],
        );
        const { rows: [prof] } = await client.query(
          `INSERT INTO profesores
             (id_usuario, nomap_p, huella_p, activo_p,
              direccion_p, telefono_p, celular_p, fecha_nac_p, mail_p)
           VALUES ($1, $2, '', true, $3, $4, $5, $6, $7) RETURNING id_profesor`,
          [usuario.id_usuario, nombre_apellido,
           direccion || null, telefono || null, celular || null,
           fecha_nac || null, mail || null],
        );

        const contrato = await crearContrato(
          client, prof.id_profesor,
          { fecha_alta, duracion_meses, observaciones, condiciones },
          req.user.id,
        );

        await client.query("COMMIT");
        return reply.code(201).send({
          id_usuario:      usuario.id_usuario,
          id_profesor:     prof.id_profesor,
          id_contrato:     contrato.id_contrato,
          nombre_apellido,
          dni,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        if (e.code === "23505")
          return reply.code(409).send({ error: "El DNI ya está registrado" });
        if (e instanceof ContratoError)
          return reply.code(e.statusCode).send({ error: e.message });
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // PUT /api/admin/profesores/:id
  // activo_p ya no se toca acá: lo derivan las funciones de contrato
  // (rescindir_contrato_profesor / vencer_contratos_profesor / crearContrato).
  app.put("/:id", {
    ...admin,
    schema: {
      body: {
        type: "object",
        properties: {
          nombre_apellido: { type: "string" },
          direccion: { type: "string" },
          telefono: { type: "string" },
          celular: { type: "string" },
          fecha_nac: { type: ["string", "null"], format: "date" },
          mail: { type: ["string", "null"], format: "email" },
        },
      },
    },
  }, async (req, reply) => {
    const {
      nombre_apellido, direccion, telefono, celular, fecha_nac, mail,
    } = req.body;
    const { rows } = await query(
      `UPDATE profesores SET
        nomap_p      = COALESCE($1, nomap_p),
        direccion_p  = COALESCE($2, direccion_p),
        telefono_p   = COALESCE($3, telefono_p),
        celular_p    = COALESCE($4, celular_p),
        fecha_nac_p  = COALESCE($5, fecha_nac_p),
        mail_p       = COALESCE($6, mail_p)
       WHERE id_profesor = $7 RETURNING *`,
      [nombre_apellido, direccion, telefono, celular, fecha_nac, mail, req.params.id],
    );
    if (!rows[0])
      return reply.code(404).send({ error: "Profesor no encontrado" });
    return rows[0];
  });

  // GET /api/admin/profesores/:id/alumnos — alumnos que asisten a sus horarios
  // (como titular o como co-profesor), para ver el listado completo de quién
  // va a cada clase.
  app.get("/:id/alumnos", admin, async (req, reply) => {
    const { rows } = await query(
      `SELECT h.id_horario, h.dia_h, h.hora_h, a.nombre_a, d.nombre_d,
              c.id_cliente, c.nomap_c, u.dni_u, s.pago_s
       FROM horarios h
       JOIN actividades a ON a.id_actividad = h.id_actividad
       JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
       JOIN inscripcion i ON i.id_horario = h.id_horario
       JOIN clientes c ON c.id_cliente = i.id_cliente
       JOIN usuarios u ON u.id_usuario = c.id_usuario
       LEFT JOIN LATERAL (
         SELECT s2.pago_s FROM suscripciones s2
         WHERE s2.id_inscripto = i.id_inscripto
         ORDER BY s2.fecha_s DESC, s2.id_suscripcion DESC
         LIMIT 1
       ) s ON true
       WHERE (h.id_profesor = $1 OR EXISTS (
               SELECT 1 FROM horario_profesores hp
               WHERE hp.id_horario = h.id_horario AND hp.id_profesor = $1
             ))
         AND c.activo_c = true
       ORDER BY ARRAY_POSITION(ARRAY['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'], h.dia_h),
                h.hora_h, c.nomap_c`,
      [req.params.id],
    );
    return rows;
  });

  // GET /api/admin/profesores/:id/contratos — historial completo
  app.get("/:id/contratos", admin, async (req, reply) => {
    const { rows: contratos } = await query(
      `SELECT * FROM contratos_profesor WHERE id_profesor = $1 ORDER BY fecha_alta DESC`,
      [req.params.id],
    );
    if (contratos.length === 0) return [];

    const { rows: condiciones } = await query(
      `SELECT cc.id_condicion, cc.id_contrato, cc.id_disciplina, d.nombre_d AS disciplina,
              cc.modalidad, cc.valor
       FROM contrato_condiciones cc
       JOIN disciplinas d ON d.id_disciplina = cc.id_disciplina
       WHERE cc.id_contrato = ANY($1::bigint[])`,
      [contratos.map(c => c.id_contrato)],
    );

    const porContrato = {};
    for (const c of condiciones) {
      (porContrato[c.id_contrato] ??= []).push(c);
    }
    return contratos.map(c => ({ ...c, condiciones: porContrato[c.id_contrato] || [] }));
  });

  // GET /api/admin/profesores/:id/contrato-vigente
  app.get("/:id/contrato-vigente", admin, async (req, reply) => {
    const { rows: [row] } = await query(
      `SELECT * FROM v_profesores_contrato WHERE id_profesor = $1`,
      [req.params.id],
    );
    if (!row?.id_contrato)
      return reply.code(404).send({ error: "El profesor no tiene contrato vigente" });
    return row;
  });

  // POST /api/admin/profesores/:id/contratos — alta / renovación
  // Si había un contrato vigente, se cierra (rescindido, motivo "Renovación")
  // sin tocar activo_p, y se crea el nuevo en la misma transacción.
  app.post("/:id/contratos", admin, async (req, reply) => {
    const id_profesor = req.params.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE contratos_profesor
         SET estado = 'rescindido', fecha_baja = CURRENT_DATE,
             tipo_baja = 'manual', motivo_baja = 'Renovación de contrato',
             id_usuario_baja = $2
         WHERE id_profesor = $1 AND estado = 'vigente'`,
        [id_profesor, req.user.id],
      );

      const contrato = await crearContrato(client, id_profesor, req.body, req.user.id);
      const condiciones = await obtenerCondiciones(client, contrato.id_contrato);

      // Un contrato nuevo implica que el profesor vuelve a estar activo
      // (cubre el caso de "reactivar" a alguien con un contrato vencido/rescindido).
      await client.query(
        `UPDATE profesores SET activo_p = true WHERE id_profesor = $1`,
        [id_profesor],
      );

      await client.query("COMMIT");
      return reply.code(201).send({ ...contrato, condiciones });
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code === "23505")
        return reply.code(409).send({ error: "Ya existe un contrato vigente para este profesor" });
      if (e instanceof ContratoError)
        return reply.code(e.statusCode).send({ error: e.message });
      throw e;
    } finally {
      client.release();
    }
  });
}
