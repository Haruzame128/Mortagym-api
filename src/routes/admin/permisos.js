import { query } from "../../config/database.js";

export default async function permisosRoutes(app) {
  const gestionar = { preHandler: [app.authenticate, app.requierePermiso("usuarios.gestionar")] };

  // GET /api/admin/permisos — catálogo agrupado por módulo
  app.get("/", gestionar, async () => {
    const { rows } = await query(`SELECT id_permiso, clave, modulo, descripcion FROM permisos ORDER BY modulo, clave`);
    const porModulo = {};
    for (const p of rows) {
      (porModulo[p.modulo] ??= []).push({ ...p, id_permiso: Number(p.id_permiso) });
    }
    return porModulo;
  });
}
