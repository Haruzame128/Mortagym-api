import { query } from '../src/config/database.js'

// Agrega columnas de observación para las preguntas de la historia clínica
// que hasta ahora no tenían campo de detalle (solo sí/no).
const COLUMNAS = [
  'patologia_columna_det',
  'mareos_det',
  'dolor_cabeza_det',
  'desmayos_det',
  'hemorragias_nasales_det',
  'dolores_articulaciones_det',
  'pie_plano_det',
  'problemas_rodilla_det',
  'cirugias_det',
  'convulsiones_det',
  'problemas_respiratorios_det',
]

for (const col of COLUMNAS) {
  await query(`ALTER TABLE ficha_medica ADD COLUMN IF NOT EXISTS ${col} TEXT`)
}

const { rows } = await query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'ficha_medica' AND column_name LIKE '%_det'
  ORDER BY column_name
`)
console.log(rows)
process.exit(0)
