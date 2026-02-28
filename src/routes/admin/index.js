import usuariosRoutes    from './usuarios.js'
import clientesRoutes    from './clientes.js'
import profesoresRoutes  from './profesores.js'
import disciplinasRoutes from './disciplinas.js'
import actividadesRoutes from './actividades.js'
import horariosRoutes    from './horarios.js'

export default async function adminRoutes(app) {
  app.register(usuariosRoutes,    { prefix: '/usuarios' })
  app.register(clientesRoutes,    { prefix: '/clientes' })
  app.register(profesoresRoutes,  { prefix: '/profesores' })
  app.register(disciplinasRoutes, { prefix: '/disciplinas' })
  app.register(actividadesRoutes, { prefix: '/actividades' })
  app.register(horariosRoutes,    { prefix: '/horarios' })
}