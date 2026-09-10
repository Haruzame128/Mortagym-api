import { query } from '../src/config/database.js'

// El precio de matrícula anual no es uniforme: varía según cuántas veces por
// semana asiste el cliente a esa disciplina (igual que la cuota mensual).
// Se agregan monto_1..monto_6 y se migran los valores actuales (columna
// `monto`, que queda sin usar pero no se borra) como punto de partida —
// mismo precio en las 6 franjas hasta que el admin las diferencie.
for (const n of [1, 2, 3, 4, 5, 6]) {
  await query(`ALTER TABLE matricula_precio ADD COLUMN IF NOT EXISTS monto_${n} NUMERIC(12,2)`)
}
await query(`
  UPDATE matricula_precio SET
    monto_1 = COALESCE(monto_1, monto), monto_2 = COALESCE(monto_2, monto),
    monto_3 = COALESCE(monto_3, monto), monto_4 = COALESCE(monto_4, monto),
    monto_5 = COALESCE(monto_5, monto), monto_6 = COALESCE(monto_6, monto)
`)
// `monto` queda sin usar (reemplazado por monto_1..6) — ya no se completa en
// altas nuevas, así que no puede seguir siendo NOT NULL.
await query(`ALTER TABLE matricula_precio ALTER COLUMN monto DROP NOT NULL`)

// CREATE OR REPLACE no reemplaza una función si cambia la lista de
// parámetros — crea un overload nuevo y deja el viejo colgado, causando
// "function ... is not unique" en llamadas ambiguas. Hay que borrar la
// firma anterior (7 parámetros) explícitamente.
await query(`DROP FUNCTION IF EXISTS registrar_matricula(bigint, bigint, bigint, character varying, integer, numeric, text)`)

await query(`
  CREATE OR REPLACE FUNCTION registrar_matricula(
    p_id_cliente bigint,
    p_id_disciplina bigint,
    p_id_usuario bigint DEFAULT NULL,
    p_medio_pago character varying DEFAULT 'Efectivo',
    p_anio integer DEFAULT NULL,
    p_monto numeric DEFAULT NULL,
    p_observaciones text DEFAULT NULL,
    p_cantidad_dias integer DEFAULT NULL
  )
  RETURNS bigint
  LANGUAGE plpgsql
  AS $function$
  DECLARE
    v_anio       integer;
    v_monto      numeric(12,2);
    v_categoria  bigint;
    v_movimiento bigint;
    v_matricula  bigint;
    v_id_usuario_cliente bigint;
    v_nombre     varchar;
    v_disciplina varchar;
  BEGIN
    v_anio := COALESCE(p_anio, EXTRACT(YEAR FROM CURRENT_DATE)::int);

    IF p_monto IS NOT NULL THEN
      v_monto := p_monto;
    ELSE
      IF p_cantidad_dias IS NULL THEN
        RAISE EXCEPTION 'No se pudo determinar la cantidad de dias por semana del cliente % en la disciplina %',
                        p_id_cliente, p_id_disciplina;
      END IF;

      SELECT CASE p_cantidad_dias
               WHEN 1 THEN monto_1 WHEN 2 THEN monto_2 WHEN 3 THEN monto_3
               WHEN 4 THEN monto_4 WHEN 5 THEN monto_5 WHEN 6 THEN monto_6
             END
        INTO v_monto
        FROM matricula_precio
       WHERE id_disciplina = p_id_disciplina AND anio = v_anio;
    END IF;

    IF v_monto IS NULL OR v_monto <= 0 THEN
      RAISE EXCEPTION 'No hay precio de matricula configurado para % dia(s)/semana en la disciplina % (%)',
                      p_cantidad_dias, p_id_disciplina, v_anio;
    END IF;

    IF EXISTS (SELECT 1 FROM matriculas
                WHERE id_cliente = p_id_cliente
                  AND id_disciplina = p_id_disciplina
                  AND anio = v_anio) THEN
      RAISE EXCEPTION 'El cliente % ya pago la matricula de esa disciplina en %',
                      p_id_cliente, v_anio
            USING ERRCODE = 'unique_violation';
    END IF;

    SELECT c.id_usuario, c.nomap_c INTO v_id_usuario_cliente, v_nombre
      FROM clientes c WHERE c.id_cliente = p_id_cliente;
    IF v_id_usuario_cliente IS NULL THEN
      RAISE EXCEPTION 'No existe el cliente %', p_id_cliente;
    END IF;

    SELECT nombre_d INTO v_disciplina FROM disciplinas
     WHERE id_disciplina = p_id_disciplina;

    SELECT id_categoria INTO v_categoria FROM categorias_movimiento
     WHERE nombre_cm ILIKE 'matr%' AND tipo_cm = 'Ingreso' LIMIT 1;

    INSERT INTO movimientos (id_categoria, id_usuario, tipo_m, origen_m, monto_m,
                             descripcion_m, medio_pago_m, fecha_m, anulado_m)
    VALUES (v_categoria, v_id_usuario_cliente, 'Ingreso', 'Automatico', v_monto,
            'Matricula ' || v_anio || ' ' || COALESCE(v_disciplina,'') || ' - ' || v_nombre,
            p_medio_pago, CURRENT_DATE, false)
    RETURNING id_movimiento INTO v_movimiento;

    INSERT INTO matriculas (id_cliente, id_disciplina, anio, fecha_pago, monto,
                            medio_pago, id_movimiento, id_usuario_cobro, observaciones)
    VALUES (p_id_cliente, p_id_disciplina, v_anio, CURRENT_DATE, v_monto,
            p_medio_pago, v_movimiento, p_id_usuario, p_observaciones)
    RETURNING id_matricula INTO v_matricula;

    RETURN v_matricula;
  END;
  $function$
`)

await query(`DROP VIEW IF EXISTS v_matriculas_estado`)
await query(`
  CREATE VIEW v_matriculas_estado AS
  SELECT DISTINCT
    c.id_cliente, c.nomap_c, u.dni_u, c.telefono_c,
    d.id_disciplina, d.nombre_d AS disciplina,
    EXTRACT(year FROM CURRENT_DATE)::integer AS anio_actual,
    cd.cantidad_dias,
    m.fecha_pago, m.monto, m.medio_pago,
    m.id_matricula IS NOT NULL AS paga,
    CASE cd.cantidad_dias
      WHEN 1 THEN mp.monto_1 WHEN 2 THEN mp.monto_2 WHEN 3 THEN mp.monto_3
      WHEN 4 THEN mp.monto_4 WHEN 5 THEN mp.monto_5 WHEN 6 THEN mp.monto_6
    END AS monto_vigente
  FROM clientes c
  JOIN usuarios u ON u.id_usuario = c.id_usuario
  JOIN inscripcion i ON i.id_cliente = c.id_cliente
  JOIN actividades a ON a.id_actividad = i.id_actividad
  JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
  LEFT JOIN LATERAL (
    SELECT MAX(s.cantidad_dias) AS cantidad_dias
    FROM inscripcion i2
    JOIN actividades a2 ON a2.id_actividad = i2.id_actividad
    JOIN LATERAL (
      SELECT cantidad_dias FROM suscripciones s2
      WHERE s2.id_inscripto = i2.id_inscripto
      ORDER BY s2.fecha_s DESC, s2.id_suscripcion DESC LIMIT 1
    ) s ON true
    WHERE i2.id_cliente = c.id_cliente AND a2.id_disciplina = d.id_disciplina
  ) cd ON true
  LEFT JOIN matricula_precio mp ON mp.id_disciplina = d.id_disciplina
    AND mp.anio = EXTRACT(year FROM CURRENT_DATE)::integer
  LEFT JOIN matriculas m ON m.id_cliente = c.id_cliente
    AND m.id_disciplina = d.id_disciplina
    AND m.anio = EXTRACT(year FROM CURRENT_DATE)::integer
  WHERE c.activo_c = true AND d.requiere_matricula = true
`)

const { rows } = await query(`SELECT id_disciplina, anio, monto, monto_1, monto_2, monto_3, monto_4, monto_5, monto_6 FROM matricula_precio`)
console.log(rows)
process.exit(0)
