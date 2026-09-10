import { query, pool } from "../../config/database.js";
import { invalidarCachePermisos } from "../../services/permisos.js";

export default async function rolesRoutes(app) {
  // La gestión de roles/permisos vive detrás del mismo permiso que la
  // gestión de usuarios: definir qué puede hacer un rol es parte de
  // administrar quién puede hacer qué.
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso("usuarios.gestionar")] };

  const numerico = (v) => (v === null || v === undefined ? v : Number(v));

  const normalizarRol = (r) => ({
    ...r,
    id_rol: numerico(r.id_rol),
    es_sistema: r.es_sistema === true || r.es_sistema === "true",
    activo: r.activo === true || r.activo === "true",
    usuarios: numerico(r.usuarios),
    permisos: r.permisos || [],
  });

  // GET /api/admin/roles
  app.get("/", gestionar, async () => {
    const { rows } = await query(`SELECT * FROM v_roles_permisos ORDER BY nombre_rol`);
    return rows.map(normalizarRol);
  });

  const setearPermisos = async (client, id_rol, claves) => {
    await client.query(`DELETE FROM rol_permisos WHERE id_rol = $1`, [id_rol]);
    if (!claves?.length) return;
    await client.query(
      `INSERT INTO rol_permisos (id_rol, id_permiso)
       SELECT $1, id_permiso FROM permisos WHERE clave = ANY($2::varchar[])`,
      [id_rol, claves],
    );
  };

  // POST /api/admin/roles — crea un rol nuevo (siempre es_sistema = false)
  app.post(
    "/",
    {
      ...gestionar,
      schema: {
        body: {
          type: "object",
          required: ["nombre_rol"],
          properties: {
            nombre_rol:  { type: "string", minLength: 2, maxLength: 30 },
            descripcion: { type: "string", maxLength: 200 },
            permisos:    { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const { nombre_rol, descripcion, permisos } = req.body;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: [rol] } = await client.query(
          `INSERT INTO roles (nombre_rol, descripcion, es_sistema, activo)
           VALUES ($1, $2, false, true) RETURNING id_rol`,
          [nombre_rol, descripcion || null],
        );
        await setearPermisos(client, rol.id_rol, permisos);
        await client.query("COMMIT");
        invalidarCachePermisos();
        return reply.code(201).send({ id_rol: rol.id_rol, nombre_rol, descripcion });
      } catch (e) {
        await client.query("ROLLBACK");
        if (e.code === "23505") return reply.code(409).send({ error: "Ya existe un rol con ese nombre" });
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // PATCH /api/admin/roles/:id — descripción, nombre y/o permisos
  app.patch(
    "/:id",
    {
      ...gestionar,
      schema: {
        body: {
          type: "object",
          properties: {
            nombre_rol:  { type: "string", minLength: 2, maxLength: 30 },
            descripcion: { type: "string", maxLength: 200 },
            permisos:    { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const { nombre_rol, descripcion, permisos } = req.body;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: [rol] } = await client.query(
          `UPDATE roles SET
             nombre_rol  = COALESCE($1, nombre_rol),
             descripcion = COALESCE($2, descripcion)
           WHERE id_rol = $3 RETURNING id_rol`,
          [nombre_rol || null, descripcion ?? null, req.params.id],
        );
        if (!rol) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Rol no encontrado" });
        }
        if (permisos !== undefined) await setearPermisos(client, rol.id_rol, permisos);
        await client.query("COMMIT");
        invalidarCachePermisos();
        return { id_rol: rol.id_rol };
      } catch (e) {
        await client.query("ROLLBACK");
        if (e.code === "23505") return reply.code(409).send({ error: "Ya existe un rol con ese nombre" });
        throw e;
      } finally {
        client.release();
      }
    },
  );

  // DELETE /api/admin/roles/:id — solo roles custom y sin usuarios asignados
  app.delete("/:id", gestionar, async (req, reply) => {
    const { rows: [rol] } = await query(`SELECT nombre_rol, es_sistema FROM roles WHERE id_rol = $1`, [req.params.id]);
    if (!rol) return reply.code(404).send({ error: "Rol no encontrado" });
    if (rol.es_sistema) return reply.code(409).send({ error: "Los roles de sistema no se pueden eliminar" });

    const { rows: [{ count }] } = await query(`SELECT COUNT(*) FROM usuarios WHERE rol_u = $1`, [rol.nombre_rol]);
    if (Number(count) > 0) {
      return reply.code(409).send({ error: `El rol tiene ${count} usuario(s) asignado(s); reasignalos antes de borrarlo` });
    }

    try {
      await query(`DELETE FROM roles WHERE id_rol = $1`, [req.params.id]);
      invalidarCachePermisos();
      return { message: "Rol eliminado" };
    } catch (e) {
      if (e.code === "P0001") return reply.code(409).send({ error: e.message });
      if (e.code === "23503") return reply.code(409).send({ error: "El rol tiene usuarios asignados" });
      throw e;
    }
  });
}
