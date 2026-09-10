// Baja automática de clientes inactivos — mismo patrón ya usado para vencer
// contratos de profesores (vencer_contratos_profesor + vencer_contratos_cron):
// una función SQL hace el trabajo, un script Node la invoca y se programa a
// diario por fuera (Task Scheduler), y acá se agregan fecha_baja/tipo_baja/
// motivo_baja a clientes para poder distinguir una baja manual de una
// automática (igual que contratos_profesor ya distingue 'manual' de
// 'automatica').
//
// Regla acordada: si el cliente no tiene ninguna cuota paga (o, si nunca
// pagó, si no se inscribió) en los últimos 2 meses, se da de baja el
// cliente completo (y su usuario asociado).
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
    ALTER TABLE clientes
      ADD COLUMN IF NOT EXISTS fecha_baja DATE,
      ADD COLUMN IF NOT EXISTS tipo_baja VARCHAR(20)
        CHECK (tipo_baja IN ('manual', 'automatica')),
      ADD COLUMN IF NOT EXISTS motivo_baja TEXT
  `)

  await pool.query(`
    CREATE OR REPLACE FUNCTION dar_baja_clientes_inactivos()
    RETURNS integer
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      dados_de_baja integer;
    BEGIN
      WITH fecha_alta AS (
        SELECT id_cliente, MIN(fecha_inscripcion) AS fecha
        FROM inscripcion
        GROUP BY id_cliente
      ),
      ultimo_pago AS (
        SELECT i.id_cliente, MAX(s.fecha_s) AS fecha
        FROM suscripciones s
        JOIN inscripcion i ON i.id_inscripto = s.id_inscripto
        WHERE s.pago_s = true
        GROUP BY i.id_cliente
      ),
      candidatos AS (
        SELECT c.id_cliente, c.id_usuario
        FROM clientes c
        JOIN fecha_alta fa ON fa.id_cliente = c.id_cliente
        LEFT JOIN ultimo_pago up ON up.id_cliente = c.id_cliente
        WHERE c.activo_c = true
          AND COALESCE(up.fecha, fa.fecha) < CURRENT_DATE - INTERVAL '2 months'
      ),
      upd_clientes AS (
        UPDATE clientes c SET
          activo_c    = false,
          fecha_baja  = CURRENT_DATE,
          tipo_baja   = 'automatica',
          motivo_baja = 'Sin pago de cuota por 2 meses consecutivos'
        FROM candidatos ca
        WHERE c.id_cliente = ca.id_cliente
        RETURNING c.id_cliente, c.id_usuario
      )
      UPDATE usuarios u SET activo_u = false
      FROM upd_clientes uc
      WHERE u.id_usuario = uc.id_usuario;

      GET DIAGNOSTICS dados_de_baja = ROW_COUNT;
      RETURN dados_de_baja;
    END;
    $function$
  `)

  console.log('Columnas de baja + función dar_baja_clientes_inactivos() creadas')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => pool.end())
