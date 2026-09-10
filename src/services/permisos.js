import { query } from "../config/database.js";

// Roles: 6. Permisos: ~30. Entra entero en memoria sin problema — no se
// justifica una query por request. Se recarga sola en el próximo pedido
// después de invalidarCachePermisos() (al crear/editar/borrar un rol).
let cache = null;

async function cargarCache() {
  const { rows } = await query(`
    SELECT r.nombre_rol, p.clave
    FROM rol_permisos rp
    JOIN roles r ON r.id_rol = rp.id_rol AND r.activo = true
    JOIN permisos p ON p.id_permiso = rp.id_permiso
  `);
  const mapa = new Map();
  for (const { nombre_rol, clave } of rows) {
    if (!mapa.has(nombre_rol)) mapa.set(nombre_rol, new Set());
    mapa.get(nombre_rol).add(clave);
  }
  cache = mapa;
}

export function invalidarCachePermisos() {
  cache = null;
}

export async function permisosDeRol(rol) {
  if (!cache) await cargarCache();
  return cache.get(rol) || new Set();
}

export async function rolTienePermiso(rol, clave) {
  const permisos = await permisosDeRol(rol);
  return permisos.has(clave);
}
