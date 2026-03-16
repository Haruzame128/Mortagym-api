
import { query } from '../config/database.js'

export default async function horariosPublicoRoutes(app) {

  // GET /api/horarios — público, lo usa la página de Horarios
  app.get('/', async () => {
    const { rows } = await query(`
      SELECT
        h.id_horario,
        h.dia_h,
        TO_CHAR(h.hora_h, 'HH24:MI') AS hora,
        h.cupo_maximo,
        h.cupo_actual,
        a.nombre_a       AS actividad,
        d.nombre_d       AS disciplina,
        p.nomap_p        AS profe
      FROM horarios h
      JOIN actividades a  ON a.id_actividad  = h.id_actividad
      JOIN disciplinas d  ON d.id_disciplina = a.id_disciplina
      LEFT JOIN profesores p ON p.id_profesor = h.id_profesor
      WHERE d.activo_d = true
      ORDER BY
        ARRAY_POSITION(ARRAY['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'], h.dia_h),
        h.hora_h
    `)

    // Agrupar por día igual que el frontend espera
    const diasOrden = ['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado']
    const agrupado = diasOrden.map(dia => ({
      dia,
      clases: rows
        .filter(r => r.dia_h === dia)
        .map(r => ({
          hora:        r.hora,
          disciplina:  r.disciplina,
          actividad:   r.actividad,
          profe:       r.profe ? `Profe ${r.profe.split(' ')[0]}` : '',
          horarioReal: null,
          cupo_maximo: Number(r.cupo_maximo),
          cupo_actual: Number(r.cupo_actual),
          cupo_lleno:  Number(r.cupo_actual) >= Number(r.cupo_maximo),
        }))
    })).filter(d => d.clases.length > 0)

    return agrupado
  })

  // GET /api/horarios/disciplinas — lista de disciplinas activas para el filtro
  app.get('/disciplinas', async () => {
    const { rows } = await query(`
      SELECT DISTINCT d.nombre_d
      FROM disciplinas d
      JOIN actividades a ON a.id_disciplina = d.id_disciplina
      JOIN horarios h ON h.id_actividad = a.id_actividad
      WHERE d.activo_d = true
      ORDER BY d.nombre_d
    `)
    return rows.map(r => r.nombre_d)
  })
}