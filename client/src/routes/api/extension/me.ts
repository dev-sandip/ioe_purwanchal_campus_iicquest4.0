import { auth } from '#/lib/auth'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/extension/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authorization = request.headers.get('authorization')
        const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

        if (!token) {
          return Response.json(
            { error: 'Missing Authorization: Bearer token' },
            { status: 401 }
          )
        }

        const { payload } = await auth.api.verifyJWT({
          body: { token },
        })

        if (!payload) {
          return Response.json({ error: 'Invalid token' }, { status: 401 })
        }

        return Response.json({
          user: {
            id: payload.sub,
            email: payload.email,
            name: payload.name,
            role: payload.role,
            serviceType: payload.serviceType,
          },
        })
      },
    },
  },
})
