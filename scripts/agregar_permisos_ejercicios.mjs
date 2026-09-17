import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
})

async function main() {
  await pool.query(
    `INSERT INTO permisos (clave, modulo, descripcion) VALUES
       ('ejercicios.ver', 'ejercicios', 'Ver el catálogo de ejercicios'),
       ('ejercicios.gestionar', 'ejercicios', 'Crear, editar y eliminar ejercicios')
     ON CONFLICT (clave) DO NOTHING`
  )

  await pool.query(
    `INSERT INTO rol_permisos (id_rol, id_permiso)
     SELECT r.id_rol, p.id_permiso
     FROM roles r, permisos p
     WHERE r.nombre_rol = 'Administrador'
       AND p.clave IN ('ejercicios.ver', 'ejercicios.gestionar')
     ON CONFLICT DO NOTHING`
  )

  console.log('✅ Permisos de ejercicios creados y asignados a Administrador')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
