// Agrega fecha_vencimiento a v_matriculas_estado — la matrícula vence al año
// de la fecha en que se pagó (ej. pagada el 04/09/2026 → vence 04/09/2027),
// no el 31/12 del año calendario. Si todavía no se pagó, no hay vencimiento
// que mostrar. No requiere columna nueva en ninguna tabla: se deriva de
// fecha_pago.
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
  await pool.query(`
    CREATE OR REPLACE VIEW v_matriculas_estado AS
    SELECT DISTINCT c.id_cliente,
      c.nomap_c,
      u.dni_u,
      c.telefono_c,
      d.id_disciplina,
      d.nombre_d AS disciplina,
      EXTRACT(year FROM CURRENT_DATE)::integer AS anio_actual,
      cd.cantidad_dias,
      m.fecha_pago,
      m.monto,
      m.medio_pago,
      m.id_matricula IS NOT NULL AS paga,
      CASE cd.cantidad_dias
        WHEN 1 THEN mp.monto_1
        WHEN 2 THEN mp.monto_2
        WHEN 3 THEN mp.monto_3
        WHEN 4 THEN mp.monto_4
        WHEN 5 THEN mp.monto_5
        WHEN 6 THEN mp.monto_6
        ELSE NULL::numeric
      END AS monto_vigente,
      CASE WHEN m.fecha_pago IS NOT NULL THEN (m.fecha_pago + INTERVAL '1 year')::date ELSE NULL END AS fecha_vencimiento
    FROM clientes c
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      JOIN inscripcion i ON i.id_cliente = c.id_cliente
      JOIN actividades a ON a.id_actividad = i.id_actividad
      JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
      LEFT JOIN LATERAL (
        SELECT max(s.cantidad_dias) AS cantidad_dias
        FROM inscripcion i2
          JOIN actividades a2 ON a2.id_actividad = i2.id_actividad
          JOIN LATERAL (
            SELECT s2.cantidad_dias
            FROM suscripciones s2
            WHERE s2.id_inscripto = i2.id_inscripto
            ORDER BY s2.fecha_s DESC, s2.id_suscripcion DESC
            LIMIT 1
          ) s ON true
        WHERE i2.id_cliente = c.id_cliente AND a2.id_disciplina = d.id_disciplina
      ) cd ON true
      LEFT JOIN matricula_precio mp ON mp.id_disciplina = d.id_disciplina AND mp.anio = EXTRACT(year FROM CURRENT_DATE)::integer
      LEFT JOIN matriculas m ON m.id_cliente = c.id_cliente AND m.id_disciplina = d.id_disciplina AND m.anio = EXTRACT(year FROM CURRENT_DATE)::integer
    WHERE c.activo_c = true AND d.requiere_matricula = true
  `)
  console.log('Vista v_matriculas_estado actualizada con fecha_vencimiento')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
