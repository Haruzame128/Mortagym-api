import { query } from '../src/config/database.js'

// Nuevo rol, análogo a Medico: solo carga un plan de alimentación (PDF) al
// cliente seleccionado. El cliente lo ve en su perfil si tiene uno cargado.
await query(`
  INSERT INTO roles (nombre_rol, descripcion, es_sistema, activo)
  VALUES ('Nutricionista', 'Carga planes de alimentación a los clientes', false, true)
  ON CONFLICT (nombre_rol) DO NOTHING
`)

await query(`
  CREATE TABLE IF NOT EXISTS planes_nutricion (
    id_plan BIGSERIAL PRIMARY KEY,
    id_cliente BIGINT NOT NULL REFERENCES clientes(id_cliente),
    id_usuario_nutricionista BIGINT REFERENCES usuarios(id_usuario),
    archivo_pdf VARCHAR(255) NOT NULL,
    nombre_original VARCHAR(255),
    observaciones TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT now()
  )
`)

await query(`DROP VIEW IF EXISTS v_planes_nutricion_estado`)
await query(`
  CREATE VIEW v_planes_nutricion_estado AS
  SELECT c.id_cliente, c.nomap_c, u.dni_u, c.telefono_c,
         ult.id_plan, ult.archivo_pdf, ult.nombre_original,
         ult.observaciones, ult.creado_en AS fecha_ultimo_plan,
         (ult.id_plan IS NOT NULL) AS tiene_plan
  FROM clientes c
  JOIN usuarios u ON u.id_usuario = c.id_usuario
  LEFT JOIN LATERAL (
    SELECT id_plan, archivo_pdf, nombre_original, observaciones, creado_en
    FROM planes_nutricion p
    WHERE p.id_cliente = c.id_cliente
    ORDER BY p.creado_en DESC LIMIT 1
  ) ult ON true
  WHERE c.activo_c = true
`)

const { rows: rol } = await query(`SELECT id_rol, nombre_rol FROM roles WHERE nombre_rol = 'Nutricionista'`)
console.log('rol:', rol)
process.exit(0)
