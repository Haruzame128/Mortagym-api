import { query } from '../src/config/database.js'

// Los precios son el núcleo de la operación del gimnasio — el rol Editor
// (fotos, horarios, contenido del sitio) no debe poder modificarlos.
const { rowCount } = await query(`
  DELETE FROM rol_permisos
  WHERE id_rol = (SELECT id_rol FROM roles WHERE nombre_rol = 'Editor')
    AND id_permiso = (SELECT id_permiso FROM permisos WHERE clave = 'precios.gestionar')
`)
console.log(`Filas eliminadas: ${rowCount}`)

const { rows } = await query(`
  SELECT p.clave FROM rol_permisos rp
  JOIN roles r ON r.id_rol = rp.id_rol
  JOIN permisos p ON p.id_permiso = rp.id_permiso
  WHERE r.nombre_rol = 'Editor'
  ORDER BY p.clave
`)
console.log('Permisos actuales de Editor:', rows.map(r => r.clave))
process.exit(0)
