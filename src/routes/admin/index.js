import usuariosRoutes    from './usuarios.js'
import clientesRoutes    from './clientes.js'
import profesoresRoutes  from './profesores.js'
import disciplinasRoutes from './disciplinas.js'
import actividadesRoutes from './actividades.js'
import horariosRoutes    from './horarios.js'
import movimientosRoutes from './movimientos.js'
import sueldosRoutes     from './sueldos.js'
import contratosRoutes   from './contratos.js'
import revisionesRoutes  from './revisiones.js'
import rolesRoutes       from './roles.js'
import permisosRoutes    from './permisos.js'
import matriculasRoutes       from './matriculas.js'
import matriculaPrecioRoutes  from './matricula-precio.js'
import listaEsperaRoutes      from './lista-espera.js'
import cuposDisponiblesRoutes from './cupos-disponibles.js'
import fichaConfigRoutes      from './ficha-config.js'
import ejerciciosRoutes       from './ejercicios.js'
import categoriasEjercicioRoutes from './categorias-ejercicio.js'

export default async function adminRoutes(app) {
  app.register(usuariosRoutes,    { prefix: '/usuarios' })
  app.register(rolesRoutes,       { prefix: '/roles' })
  app.register(permisosRoutes,    { prefix: '/permisos' })
  app.register(clientesRoutes,    { prefix: '/clientes' })
  app.register(profesoresRoutes,  { prefix: '/profesores' })
  app.register(disciplinasRoutes, { prefix: '/disciplinas' })
  app.register(actividadesRoutes, { prefix: '/actividades' })
  app.register(horariosRoutes,    { prefix: '/horarios' })
  app.register(movimientosRoutes, { prefix: '/movimientos' })
  app.register(sueldosRoutes,     { prefix: '/sueldos' })
  app.register(contratosRoutes,   { prefix: '/contratos' })
  app.register(revisionesRoutes,  { prefix: '/revisiones' })
  app.register(matriculasRoutes,       { prefix: '/matriculas' })
  app.register(matriculaPrecioRoutes,  { prefix: '/matricula-precio' })
  app.register(listaEsperaRoutes,      { prefix: '/lista-espera' })
  app.register(cuposDisponiblesRoutes, { prefix: '/cupos-disponibles' })
  app.register(fichaConfigRoutes,      { prefix: '/ficha-config' })
  app.register(ejerciciosRoutes,       { prefix: '/ejercicios' })
  app.register(categoriasEjercicioRoutes, { prefix: '/categorias-ejercicio' })
}