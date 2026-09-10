const MODALIDADES = ['porcentaje', 'por_hora', 'monto_fijo']

class ContratoError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

export { ContratoError }

export const validarCondiciones = (condiciones) => {
  if (!Array.isArray(condiciones) || condiciones.length === 0) {
    throw new ContratoError('El contrato debe tener al menos una condición (disciplina + modalidad + valor)')
  }
  for (const c of condiciones) {
    if (!c.id_disciplina || !c.modalidad || c.valor == null) {
      throw new ContratoError('Cada condición requiere id_disciplina, modalidad y valor')
    }
    if (!MODALIDADES.includes(c.modalidad)) {
      throw new ContratoError(`Modalidad inválida: ${c.modalidad}`)
    }
    if (Number(c.valor) <= 0) {
      throw new ContratoError('El valor de cada condición debe ser mayor a 0')
    }
    if (c.modalidad === 'porcentaje' && Number(c.valor) > 100) {
      throw new ContratoError('El porcentaje no puede ser mayor a 100')
    }
  }
  const disciplinas = condiciones.map(c => c.id_disciplina)
  if (new Set(disciplinas).size !== disciplinas.length) {
    throw new ContratoError('No puede haber más de una condición para la misma disciplina')
  }
}

// Inserta el contrato + condiciones dentro de una transacción ya abierta (BEGIN hecho por el caller).
export const crearContrato = async (client, id_profesor, datos, id_usuario) => {
  const { fecha_alta, duracion_meses, fecha_vencimiento, observaciones, condiciones } = datos
  validarCondiciones(condiciones)

  const { rows: [contrato] } = await client.query(
    `INSERT INTO contratos_profesor
       (id_profesor, fecha_alta, duracion_meses, fecha_vencimiento, observaciones, id_usuario_alta)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6)
     RETURNING *`,
    [id_profesor, fecha_alta || null, duracion_meses || null,
     fecha_vencimiento || null, observaciones || null, id_usuario || null]
  )

  for (const c of condiciones) {
    await client.query(
      `INSERT INTO contrato_condiciones (id_contrato, id_disciplina, modalidad, valor)
       VALUES ($1, $2, $3, $4)`,
      [contrato.id_contrato, c.id_disciplina, c.modalidad, c.valor]
    )
  }

  return contrato
}

export const obtenerCondiciones = async (client, id_contrato) => {
  const { rows } = await client.query(
    `SELECT cc.id_condicion, cc.id_disciplina, d.nombre_d AS disciplina, cc.modalidad, cc.valor
     FROM contrato_condiciones cc
     JOIN disciplinas d ON d.id_disciplina = cc.id_disciplina
     WHERE cc.id_contrato = $1
     ORDER BY d.nombre_d`,
    [id_contrato]
  )
  return rows
}
