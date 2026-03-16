
import { pool } from '../src/config/database.js'
import 'dotenv/config'

// IDs de disciplinas
const D = { natacion: 6, funcional: 7, pilates: 8, musculacion: 9, judo: 10 }

// IDs de profesores
const P = {
  araceli:  1,   // Montenegro Paula Araceli
  lucia:    7,   // Valenzuela Lucia
  nadia:    9,   // Pereyra Nadia
  gaston:   17,  // Diaz Gastón
  belen:    26,  // Castro Belen
  alicia:   27,  // Bazan Alicia Matilde
  julio:    28,  // Carez Julio
  irene:    29,  // Grodski Inostroza Irene
  milagros: 30,  // Lopez Milagros
}

// Actividades a crear: { disciplina, nombre, descripcion }
const actividades = [
  // Musculación
  { d: D.musculacion, nombre: 'Musculación', desc: 'Entrenamiento de fuerza y tonificación muscular.' },

  // Pilates
  { d: D.pilates, nombre: 'Pilates', desc: 'Ejercicios de fortalecimiento, postura y flexibilidad.' },

  // Funcional
  { d: D.funcional, nombre: 'Funcional Adultos Mayores', desc: 'Entrenamiento funcional adaptado para adultos mayores.' },
  { d: D.funcional, nombre: 'Full Body',                 desc: 'Entrenamiento funcional de cuerpo completo.' },
  { d: D.funcional, nombre: 'Funcional Adultos',         desc: 'Entrenamiento funcional de alta intensidad para adultos.' },
  { d: D.funcional, nombre: 'Funcional Adolescentes',    desc: 'Entrenamiento funcional orientado a jóvenes.' },

  // Judo
  { d: D.judo, nombre: 'Judo 4 a 12 años',  desc: 'Clases de judo para niños de 4 a 12 años.' },
  { d: D.judo, nombre: 'Judo 12 a 18 años', desc: 'Clases de judo para jóvenes de 12 a 18 años.' },
  { d: D.judo, nombre: 'Judo +13 años',     desc: 'Judo avanzado para mayores de 13 años.' },

  // Natación
  { d: D.natacion, nombre: 'Natación Adultos Iniciales',        desc: 'Natación para adultos que se inician en el agua.' },
  { d: D.natacion, nombre: 'Natación Adultos Intermedio/Avanzado', desc: 'Natación para adultos con experiencia previa.' },
  { d: D.natacion, nombre: 'Natación Adultos Avanzados',        desc: 'Natación de alto rendimiento para adultos.' },
  { d: D.natacion, nombre: 'Hidrogimnasia',                     desc: 'Gimnasia acuática de bajo impacto.' },
  { d: D.natacion, nombre: 'Natación 7-8 años',                 desc: 'Clases de natación para niños de 7 a 8 años.' },
  { d: D.natacion, nombre: 'Natación 7-8 años Iniciales',       desc: 'Natación inicial para niños de 7 a 8 años.' },
  { d: D.natacion, nombre: 'Natación 9-10 años',                desc: 'Clases de natación para niños de 9 a 10 años.' },
  { d: D.natacion, nombre: 'Natación 9-10-11 años',             desc: 'Clases de natación para niños de 9 a 11 años.' },
  { d: D.natacion, nombre: 'Natación 8-9-10 años',              desc: 'Clases de natación para niños de 8 a 10 años.' },
  { d: D.natacion, nombre: 'Natación 8-9 años',                 desc: 'Clases de natación para niños de 8 a 9 años.' },
  { d: D.natacion, nombre: 'Natación 11-12 años',               desc: 'Clases de natación para niños de 11 a 12 años.' },
  { d: D.natacion, nombre: 'Natación 5-6 años',                 desc: 'Clases de natación para niños de 5 a 6 años.' },
  { d: D.natacion, nombre: 'Natación 3-4 años',                 desc: 'Natación para niños de 3 a 4 años.' },
  { d: D.natacion, nombre: 'Natación Bebés (+6 meses) y 3-4 años', desc: 'Natación para bebés y niños pequeños.' },
  { d: D.natacion, nombre: 'Adolescentes +12 años',             desc: 'Natación para adolescentes mayores de 12 años.' },
  { d: D.natacion, nombre: 'Pileta Libre',                      desc: 'Nado libre sin instructor.' },
  { d: D.natacion, nombre: 'Terapia Acuática',                  desc: 'Sesiones terapéuticas en el agua.' },
  { d: D.natacion, nombre: 'Natación Familiar',                 desc: 'Sesión de natación para familias.' },
]

async function seed() {
  const client = await pool.connect()
  try {
    // ── 1. Insertar actividades ──────────────────────────────────
    console.log('📋 Insertando actividades...')
    const actIds = {}
    for (const a of actividades) {
      const { rows: [r] } = await client.query(
        `INSERT INTO actividades (id_disciplina, nombre_a, descripcion_a, max_inasistencia)
         VALUES ($1, $2, $3, 3) RETURNING id_actividad, nombre_a`,
        [a.d, a.nombre, a.desc]
      )
      actIds[a.nombre] = r.id_actividad
      console.log(`  ✅ ${r.nombre_a} → id ${r.id_actividad}`)
    }

    // ── 2. Función helper para insertar horario ──────────────────
    let count = 0
    const h = async (nombre_act, dia, hora, profesor_id = null, cupo = 20) => {
      const id_act = actIds[nombre_act]
      if (!id_act) { console.error(`❌ Actividad no encontrada: ${nombre_act}`); return }
      await client.query(
        `INSERT INTO horarios (id_actividad, dia_h, hora_h, cupo_maximo, cupo_actual, id_profesor)
         VALUES ($1, $2, $3, $4, 0, $5)`,
        [id_act, dia, hora, cupo, profesor_id]
      )
      count++
    }

    console.log('\n📅 Insertando horarios...')

    // ── MUSCULACIÓN ──────────────────────────────────────────────
    for (const dia of ['Lunes','Martes','Miercoles','Jueves','Viernes']) {
      for (const hora of ['07:00','08:00','09:00','10:00']) await h('Musculación', dia, hora, P.araceli)
      for (const hora of ['11:00','12:00'])                 await h('Musculación', dia, hora, P.belen)
      for (const hora of ['13:00','14:00','15:00','16:00','17:00','18:00']) await h('Musculación', dia, hora, P.gaston)
      for (const hora of ['19:00','20:00','21:00'])         await h('Musculación', dia, hora, P.belen)
    }
    for (const hora of ['10:00','11:00','12:00','13:00']) await h('Musculación', 'Sabado', hora, null)

    // ── PILATES ──────────────────────────────────────────────────
    for (const dia of ['Lunes','Martes','Miercoles','Jueves','Viernes']) {
      for (const hora of ['08:00','09:00','10:00'])         await h('Pilates', dia, hora, P.nadia)
      for (const hora of ['14:00','15:00'])                 await h('Pilates', dia, hora, P.alicia)
      for (const hora of ['17:00','18:00','19:00','20:00','21:00']) await h('Pilates', dia, hora, P.lucia)
    }

    // ── FUNCIONAL ────────────────────────────────────────────────
    for (const dia of ['Martes','Jueves']) {
      await h('Funcional Adultos Mayores', dia, '11:00', P.araceli)
      await h('Full Body',                 dia, '14:00', P.milagros)
      await h('Funcional Adultos',         dia, '15:00', P.milagros)
      await h('Funcional Adolescentes',    dia, '16:00', P.milagros)
    }

    // ── JUDO ─────────────────────────────────────────────────────
    for (const dia of ['Lunes','Miercoles','Viernes']) {
      await h('Judo 4 a 12 años',  dia, '18:30', P.irene, 20)
      await h('Judo 12 a 18 años', dia, '20:00', P.julio, 20)
      await h('Judo +13 años',     dia, '21:30', P.julio, 20)
    }

    // ── NATACIÓN — Lunes / Miércoles / Viernes ───────────────────
    for (const dia of ['Lunes','Miercoles','Viernes']) {
      await h('Natación Adultos Iniciales',           dia, '07:00', null)
      await h('Natación Adultos Intermedio/Avanzado', dia, '08:00', null)
      await h('Hidrogimnasia',                        dia, '09:00', null)
      await h('Natación 7-8 años',                    dia, '10:00', null)
      await h('Natación 9-10 años',                   dia, '11:00', null)
      await h('Natación Bebés (+6 meses) y 3-4 años', dia, '12:00', null)
      await h('Natación Adultos Iniciales',            dia, '13:00', null)
      await h('Natación 5-6 años',                    dia, '14:00', null)
      await h('Adolescentes +12 años',                dia, '15:00', null)
      await h('Natación Adultos Iniciales',            dia, '16:00', null)
      await h('Hidrogimnasia',                        dia, '17:00', null)
      await h('Hidrogimnasia',                        dia, '18:00', null)
      await h('Natación 9-10-11 años',                dia, '19:00', null)
      await h('Natación 8-9-10 años',                 dia, '20:00', null)
      await h('Natación Adultos Avanzados',            dia, '21:00', null)
    }

    // ── NATACIÓN — Martes / Jueves ───────────────────────────────
    for (const dia of ['Martes','Jueves']) {
      await h('Pileta Libre',                         dia, '07:00', null)
      await h('Natación Adultos Iniciales',            dia, '08:00', null)
      await h('Natación Adultos Avanzados',            dia, '09:00', null)
      await h('Natación 7-8 años Iniciales',          dia, '10:00', null)
      await h('Terapia Acuática',                     dia, '11:00', null)
      await h('Pileta Libre',                         dia, '12:00', null)
      await h('Hidrogimnasia',                        dia, '13:00', null)
      await h('Natación 3-4 años',                    dia, '14:00', null)
      await h('Natación 9-10 años',                   dia, '15:00', null)
      await h('Adolescentes +12 años',                dia, '16:00', null)
      await h('Natación Adultos Iniciales',            dia, '17:00', null)
      await h('Natación 7-8 años',                    dia, '18:00', null)
      await h('Natación 11-12 años',                  dia, '19:00', null)
      await h('Natación 8-9 años',                    dia, '20:00', null)
      await h('Natación Adultos Iniciales',            dia, '21:00', null)
    }

    // ── NATACIÓN — Sábado ────────────────────────────────────────
    await h('Hidrogimnasia',             'Sabado', '10:00', null)
    await h('Natación Adultos Iniciales', 'Sabado', '11:00', null)
    await h('Natación Familiar',          'Sabado', '12:00', null)
    await h('Hidrogimnasia',             'Sabado', '13:00', null)

    console.log(`\n✅ Listo: ${count} horarios insertados`)
  } catch(e) {
    console.error('❌ Error:', e.message)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()