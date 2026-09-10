import { query } from '../src/config/database.js'

const CONDICIONES = `3. La calidad de Socio de GIMNASIO MORTA GYM se obtiene con la inscripción y el pago del primer mes en el plan elegido. La inscripción implica la aceptación de las normas y reglamentos de uso establecidos por GIMNASIO MORTA GYM, salvo para el caso del uso del natatorio en donde además de abonar el plan deberá abonar un 50% más en calidad de matrícula por única vez.

SE DEBERÁ TENER EL CARNET DE REVISACIÓN MÉDICA AL DÍA. EN CASO DE NO CONTAR CON LA VIGENCIA DEL MISMO NO PODRÁ INGRESAR AL NATATORIO.

Las cuotas mensuales deben abonarse cada 30 días por adelantado, sin excepción. La falta de pago o mora en el mismo da derecho a MORTA GYM a la suspensión inmediata de la utilización de servicios hasta tanto se cancelen los mismos.

4. Son condiciones para la inscripción la entrega de FICHA DE APTO FÍSICO CON FIRMA Y SELLO DEL MÉDICO OTORGANTE dentro de las 24 hs posteriores a la inscripción, bajo apercibimiento de suspensión de la utilización de los servicios en forma inmediata.

5. El pago en la inscripción incluye la huella. En caso de baja y reincorporación posterior, será obligatorio el pago de nuevo de la matrícula solo en caso del plan natatorio, excepto en caso de baja médica debidamente informada, pudiendo utilizar los servicios en la medida de la disponibilidad existente por parte del GIMNASIO.

6. El uso de la huella es personal e intransferible.

7. El horario del Gimnasio MORTA GYM será de 7 AM a 22 hs en días laborables (lunes a viernes) y de 10 hs a 14 hs los sábados.

8. Los menores solo se podrán inscribir en el gimnasio MORTA GYM y hacer uso de las instalaciones con las siguientes condiciones: la solicitud de inscripción y las presentes condiciones deberán constar firmadas por el padre, madre o tutor legal y adjuntar fotocopia de su DNI. Con la firma de este documento la persona firmante como padre, madre o tutor legal se hace responsable de todos los actos del menor en las instalaciones y manifiesta que éste reúne las condiciones físicas necesarias para la práctica del deporte.

9. El socio tendrá derecho al uso general de las instalaciones dentro del horario y cuadrante del plan requerido, expuesto al público y establecido por el centro para uso libre. El uso de lockers y la custodia de los objetos personales del socio se encuentran establecidos dentro del Reglamento General de Servicios, excluyendo de responsabilidad a MORTA GYM por sus extravíos. El usuario declara conocer el Reglamento General de Servicios, las Normas de Convivencia, el manejo adecuado de los implementos y las prohibiciones del Gimnasio MORTA GYM, el cual se encuentra visible y a su disposición.

10. Está prohibido terminantemente ingresar a las instalaciones fármacos que requieran receta médica o que aumenten la potencia física (anabólicos). De la misma manera está prohibido ofrecer o distribuir dichos fármacos a otros socios, a cambio de pago o a título gratuito, así como servir de intermediario o facilitar su acceso de cualquier forma. En caso de incumplimiento culpable de esta norma, GIMNASIO MORTA GYM tendrá derecho a resolver este contrato de forma inmediata y sin previo aviso, pudiendo presentar una denuncia ante las autoridades pertinentes y solicitar reclamación por daños y perjuicios.

11. Para la correcta utilización de las instalaciones será imprescindible el uso de indumentaria y calzado deportivo adecuado.

12. EXIMICIÓN DE RESPONSABILIDAD. Habiendo tomado conocimiento de los riesgos de la práctica de gimnasia, dejo constancia de que exonero de toda responsabilidad de cualquier naturaleza tanto a la empresa GIMNASIO MORTA GYM y/o sus titulares, como al cuerpo de profesionales del gimnasio, por las consecuencias de todo ejercicio deportivo de mi persona dentro del establecimiento, declarando que mi estado de salud es óptimo para la práctica deportiva y que no poseo ninguna enfermedad que me ponga en riesgo (patologías cardiovasculares, respiratorias, presión arterial, entre otras), ni cuento con lesiones previas que pudieran agravarse con la actividad física a realizar; en caso de poseerlas, se encuentran debidamente autorizadas por el médico tratante en el apto médico para su realización, eximiendo de responsabilidad también a MORTA GYM por dichas prácticas.

13. Toda controversia por los efectos legales de la presente inscripción y utilización de servicios se dirimirá exclusivamente ante el fuero judicial de los tribunales de Caleta Olivia, Santa Cruz.`

await query(`
  CREATE TABLE IF NOT EXISTS ficha_inscripcion_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    nombre_gimnasio VARCHAR(150) NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    cuit VARCHAR(30) NOT NULL,
    condiciones TEXT NOT NULL,
    actualizado_en TIMESTAMP NOT NULL DEFAULT now()
  )
`)

await query(`
  INSERT INTO ficha_inscripcion_config (id, nombre_gimnasio, direccion, cuit, condiciones)
  VALUES (1, 'MORTA GYM', 'Calle Suriman N° 1190, Barrio Mirador, Caleta Olivia, Santa Cruz', '27-39.883.454-8', $1)
  ON CONFLICT (id) DO NOTHING
`, [CONDICIONES])

const { rows } = await query(`SELECT id, nombre_gimnasio, direccion, cuit, length(condiciones) AS largo_condiciones FROM ficha_inscripcion_config`)
console.log(rows)
process.exit(0)
