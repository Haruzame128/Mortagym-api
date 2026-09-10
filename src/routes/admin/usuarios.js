import bcrypt from "bcrypt";
import { query } from "../../config/database.js";

// Estos dos roles tienen su propia alta (crea también la fila en clientes/
// profesores). Crear un usuario "interno" con alguno de estos roles dejaría
// un usuario sin ficha asociada y rompería medio sistema.
const ROLES_CON_ALTA_PROPIA = ["Cliente", "Profesor"];

export default async function usuariosRoutes(app) {
  const ver = { preHandler: [app.authenticate, app.requierePermiso("usuarios.ver")] };
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso("usuarios.gestionar")] };

  const rolValido = async (nombre_rol) => {
    const { rows: [rol] } = await query(
      `SELECT nombre_rol FROM roles WHERE nombre_rol = $1 AND activo = true`,
      [nombre_rol],
    );
    return !!rol;
  };

  // GET /api/admin/usuarios?rol=Editor&activo=true&buscar=texto
  app.get("/", ver, async (req) => {
    const { rol, activo, buscar } = req.query;
    const condiciones = [];
    const params = [];

    if (rol) {
      params.push(rol);
      condiciones.push(`rol_u = $${params.length}`);
    }
    if (activo === "true" || activo === "false") {
      params.push(activo === "true");
      condiciones.push(`activo_u = $${params.length}`);
    }
    if (buscar) {
      params.push(`%${buscar}%`);
      condiciones.push(`(nombre ILIKE $${params.length} OR dni_u::text ILIKE $${params.length})`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    const { rows } = await query(
      `SELECT * FROM v_usuarios_admin ${where} ORDER BY rol_u, nombre NULLS LAST, dni_u`,
      params,
    );
    return rows.map((r) => ({ ...r, cantidad_permisos: Number(r.cantidad_permisos) }));
  });

  // GET /api/admin/usuarios/:id
  app.get("/:id", ver, async (req, reply) => {
    const { rows: [usuario] } = await query(`SELECT * FROM v_usuarios_admin WHERE id_usuario = $1`, [req.params.id]);
    if (!usuario) return reply.code(404).send({ error: "Usuario no encontrado" });
    return { ...usuario, cantidad_permisos: Number(usuario.cantidad_permisos) };
  });

  // POST /api/admin/usuarios — alta de usuario interno (Administrador, Recepcion, Medico, Editor, etc.)
  app.post(
    "/",
    {
      ...gestionar,
      schema: {
        body: {
          type: "object",
          required: ["dni", "nombre", "rol"],
          properties: {
            dni:        { type: "integer" },
            nombre:     { type: "string", minLength: 2 },
            rol:        { type: "string" },
            contrasena: { type: "string", minLength: 4 },
          },
        },
      },
    },
    async (req, reply) => {
      const { dni, nombre, rol, contrasena } = req.body;

      if (ROLES_CON_ALTA_PROPIA.includes(rol)) {
        return reply.code(400).send({
          error: `El rol ${rol} se da de alta desde su propia pantalla (Alumnos / Profesores), no desde acá`,
        });
      }
      if (!(await rolValido(rol))) {
        return reply.code(400).send({ error: `El rol ${rol} no existe o está inactivo` });
      }

      const hash = await bcrypt.hash(contrasena || String(dni), 10);
      try {
        const { rows: [usuario] } = await query(
          `INSERT INTO usuarios (dni_u, password_u, rol_u, nombre_u, activo_u)
           VALUES ($1, $2, $3, $4, true)
           RETURNING id_usuario, dni_u, rol_u, nombre_u, activo_u`,
          [dni, hash, rol, nombre],
        );
        return reply.code(201).send(usuario);
      } catch (e) {
        if (e.code === "23505") return reply.code(409).send({ error: "El DNI ya está registrado" });
        if (e.code === "23503") return reply.code(409).send({ error: "El rol indicado no existe" });
        throw e;
      }
    },
  );

  // PATCH /api/admin/usuarios/:id — nombre visible (usuarios internos)
  app.patch(
    "/:id",
    {
      ...gestionar,
      schema: {
        body: { type: "object", required: ["nombre"], properties: { nombre: { type: "string", minLength: 2 } } },
      },
    },
    async (req, reply) => {
      const { rows: [usuario] } = await query(
        `UPDATE usuarios SET nombre_u = $1 WHERE id_usuario = $2
         RETURNING id_usuario, dni_u, rol_u, nombre_u, activo_u`,
        [req.body.nombre, req.params.id],
      );
      if (!usuario) return reply.code(404).send({ error: "Usuario no encontrado" });
      return usuario;
    },
  );

  // PATCH /api/admin/usuarios/:id/rol
  app.patch(
    "/:id/rol",
    {
      ...gestionar,
      schema: { body: { type: "object", required: ["rol"], properties: { rol: { type: "string" } } } },
    },
    async (req, reply) => {
      if (Number(req.params.id) === Number(req.user.id)) {
        return reply.code(400).send({ error: "No podés cambiar tu propio rol" });
      }
      const { rol } = req.body;
      if (!(await rolValido(rol))) {
        return reply.code(400).send({ error: `El rol ${rol} no existe o está inactivo` });
      }
      try {
        const { rows: [usuario] } = await query(
          `UPDATE usuarios SET rol_u = $1 WHERE id_usuario = $2
           RETURNING id_usuario, dni_u, rol_u, activo_u`,
          [rol, req.params.id],
        );
        if (!usuario) return reply.code(404).send({ error: "Usuario no encontrado" });
        return usuario;
      } catch (e) {
        if (e.code === "P0001") return reply.code(409).send({ error: e.message });
        if (e.code === "23503") return reply.code(409).send({ error: "El rol indicado no existe" });
        throw e;
      }
    },
  );

  // PATCH /api/admin/usuarios/:id/estado
  app.patch(
    "/:id/estado",
    {
      ...gestionar,
      schema: { body: { type: "object", required: ["activo"], properties: { activo: { type: "boolean" } } } },
    },
    async (req, reply) => {
      if (Number(req.params.id) === Number(req.user.id)) {
        return reply.code(400).send({ error: "No podés desactivarte a vos mismo" });
      }
      try {
        const { rows: [usuario] } = await query(
          `UPDATE usuarios SET activo_u = $1 WHERE id_usuario = $2
           RETURNING id_usuario, dni_u, rol_u, activo_u`,
          [req.body.activo, req.params.id],
        );
        if (!usuario) return reply.code(404).send({ error: "Usuario no encontrado" });
        return usuario;
      } catch (e) {
        if (e.code === "P0001") return reply.code(409).send({ error: e.message });
        throw e;
      }
    },
  );

  // POST /api/admin/usuarios/:id/reset-password
  app.post(
    "/:id/reset-password",
    {
      ...gestionar,
      schema: {
        body: { type: "object", properties: { contrasena: { type: "string", minLength: 4 } } },
      },
    },
    async (req, reply) => {
      const { rows: [usuario] } = await query(`SELECT dni_u FROM usuarios WHERE id_usuario = $1`, [req.params.id]);
      if (!usuario) return reply.code(404).send({ error: "Usuario no encontrado" });

      const nueva = req.body?.contrasena || String(usuario.dni_u);
      const hash = await bcrypt.hash(nueva, 10);
      await query(`UPDATE usuarios SET password_u = $1 WHERE id_usuario = $2`, [hash, req.params.id]);

      // Si no se pidió una contraseña específica, devolvemos la generada
      // (el DNI) para que quien gestiona el usuario se la pueda pasar.
      return { message: "Contraseña actualizada", contrasena_temporal: req.body?.contrasena ? undefined : nueva };
    },
  );
}
