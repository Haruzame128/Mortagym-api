import fastifyJwt from '@fastify/jwt'

export default async function jwtPlugin(app) {
  app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET,
    sign: { expiresIn: '8h' },
  })
}