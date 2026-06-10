import { auth } from '#/lib/auth'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/extension/auth-callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const extensionId = process.env.CHROME_EXTENSION_ID

        if (!extensionId) {
          return Response.json(
            { error: 'CHROME_EXTENSION_ID is not configured' },
            { status: 500 }
          )
        }

        const { token } = await auth.api.getToken({
          headers: request.headers,
        })

        const redirectUrl = new URL(
          `chrome-extension://${extensionId}/tabs/auth-callback.html`
        )
        redirectUrl.searchParams.set('token', token)

        return Response.redirect(redirectUrl, 302)
      },
    },
  },
})
