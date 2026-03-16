
import bcrypt from 'bcrypt'
import { pool } from '../src/config/database.js'
import 'dotenv/config'

const profesores = [
  { nro_pro: 4,   dni: 39883469, apellido: 'MONTENEGRO',       nombres: 'PAULA ARACELI',      celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 7,   dni: 36926467, apellido: 'Sanchez',          nombres: 'Pablo Emiliano',     celular: '2975900216', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 8,   dni: 37195900, apellido: 'Nieto',            nombres: 'Sofia',              celular: '3513295194', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 9,   dni: 28558438, apellido: 'Aviles',           nombres: 'Cristian Ricardo',   celular: '2974730636', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 11,  dni: 40386603, apellido: 'Hernandez',        nombres: 'Agustina',           celular: '2974273605', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 15,  dni: 21520695, apellido: 'Lopez',            nombres: 'Sandra Karina',      celular: '2975069286', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 16,  dni: 42208608, apellido: 'Valenzuela',       nombres: 'Lucia',              celular: '2975085905', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 17,  dni: 39883454, apellido: 'Mortarotti',       nombres: 'Mica',               celular: '297154945174', telefono: null,       fecha_nac: null,       mail: null },
  { nro_pro: 18,  dni: 41339337, apellido: 'Pereyra',          nombres: 'Nadia',              celular: '2625418244', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 19,  dni: 30325331, apellido: 'Rojas',            nombres: 'Ivana elizabeth',    celular: '2974763939', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 20,  dni: 39206435, apellido: 'Machuca',          nombres: 'Nuria',              celular: '2975213953', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 94,  dni: null,     apellido: 'Adoricio',         nombres: 'patricia',           celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 283, dni: null,     apellido: 'Soria',            nombres: 'Mariana',            celular: '2975065711', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 670, dni: null,     apellido: 'DIAZ',             nombres: 'MERCEDES',           celular: '2974779548', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 714, dni: null,     apellido: 'Oviedo',           nombres: 'Francisco',          celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1082,dni: null,     apellido: 'Araya',            nombres: 'Brenda',             celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1083,dni: null,     apellido: 'Diaz',             nombres: 'Gastón',             celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1084,dni: null,     apellido: 'Maldonado',        nombres: 'Franco',             celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1098,dni: null,     apellido: 'LEAL',             nombres: 'LEANDRO',            celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1186,dni: null,     apellido: 'OYARZUN',          nombres: 'ALEJANDRA',          celular: null,         telefono: '2966611919', fecha_nac: null,       mail: null },
  { nro_pro: 1303,dni: null,     apellido: 'OVIEDO',           nombres: 'FRANCISCO',          celular: '2974116363', telefono: null,         fecha_nac: '2001-10-12', mail: null },
  { nro_pro: 1306,dni: 37442026, apellido: 'JUAREZ',           nombres: 'EMILSE JESSICA',     celular: '2974621506', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1307,dni: null,     apellido: 'RUSSO',            nombres: 'LUCIANO',            celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1355,dni: null,     apellido: 'godoy',            nombres: 'caro',               celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1541,dni: null,     apellido: 'LA VALLEN',        nombres: 'ROCIO',              celular: '2975043513', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1603,dni: null,     apellido: 'castro',           nombres: 'belen',              celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1656,dni: null,     apellido: 'BAZAN',            nombres: 'ALICIA MATILDE',     celular: null,         telefono: '2974016850', fecha_nac: null,       mail: null },
  { nro_pro: 1996,dni: null,     apellido: 'CAREZ',            nombres: 'JULIO',              celular: '2974242267', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 1997,dni: null,     apellido: 'GRODSKI INOSTROZA',nombres: 'IRENE',              celular: '2975489879', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 2005,dni: null,     apellido: 'LOPEZ',            nombres: 'MILAGROS',           celular: '2625705977', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 2026,dni: null,     apellido: 'osses',            nombres: 'maria elena',        celular: '2975076081', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 2122,dni: null,     apellido: 'chacoma',          nombres: 'paola anabel',       celular: '2974307775', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 2143,dni: null,     apellido: 'MENDEZ',           nombres: 'CARLITA',            celular: null,         telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 2239,dni: null,     apellido: 'MENDEZ',           nombres: 'CARLA',              celular: '2974085270', telefono: null,         fecha_nac: null,       mail: null },
  { nro_pro: 2240,dni: null,     apellido: 'DIAZ',             nombres: 'MRCEDES',            celular: '2974779548', telefono: null,         fecha_nac: null,       mail: null },
]

async function seed() {
  const client = await pool.connect()
  let insertados = 0
  let errores = 0

  try {
    for (const p of profesores) {
      const dniLogin = p.dni || p.nro_pro
      const nombre = `${p.apellido} ${p.nombres}`.trim()
      const hash = await bcrypt.hash(String(dniLogin), 10)

      try {
        await client.query('BEGIN')

        const { rows: [usuario] } = await client.query(
          `INSERT INTO usuarios (dni_u, password_u, rol_u, activo_u)
           VALUES ($1, $2, 'Profesor', true)
           ON CONFLICT DO NOTHING
           RETURNING id_usuario`,
          [dniLogin, hash]
        )

        if (!usuario) {
          // El DNI ya existe, buscar el usuario
          const { rows: [existente] } = await client.query(
            `SELECT id_usuario FROM usuarios WHERE dni_u = $1`, [dniLogin]
          )
          if (!existente) { await client.query('ROLLBACK'); errores++; continue }

          await client.query(
            `INSERT INTO profesores (id_usuario, nomap_p, huella_p, activo_p, porcentaje_p, celular_p, telefono_p, fecha_nac_p, mail_p)
             VALUES ($1,$2,'',true,0,$3,$4,$5,$6)
             ON CONFLICT DO NOTHING`,
            [existente.id_usuario, nombre, p.celular, p.telefono, p.fecha_nac, p.mail]
          )
        } else {
          await client.query(
            `INSERT INTO profesores (id_usuario, nomap_p, huella_p, activo_p, porcentaje_p, celular_p, telefono_p, fecha_nac_p, mail_p)
             VALUES ($1,$2,'',true,0,$3,$4,$5,$6)`,
            [usuario.id_usuario, nombre, p.celular, p.telefono, p.fecha_nac, p.mail]
          )
        }

        await client.query('COMMIT')
        insertados++
        console.log(`✅ ${nombre}`)
      } catch (e) {
        await client.query('ROLLBACK')
        console.error(`❌ ${nombre}: ${e.message}`)
        errores++
      }
    }
  } finally {
    client.release()
    await pool.end()
  }

  console.log(`\n📊 Resultado: ${insertados} insertados, ${errores} errores`)
}

seed()