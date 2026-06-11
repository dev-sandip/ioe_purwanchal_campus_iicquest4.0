import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const extensionId = process.env.CHROME_EXTENSION_ID

  if (!extensionId) {
    return NextResponse.json(
      { error: 'CHROME_EXTENSION_ID is not configured' },
      { status: 500 },
    )
  }

  const { token } = await auth.api.getToken({
    headers: request.headers,
  })

  if (!token) {
    return NextResponse.redirect(new URL('/login?source=extension', request.url))
  }

  const redirectUrl = new URL(
    `chrome-extension://${extensionId}/tabs/auth-callback.html`,
  )

  redirectUrl.searchParams.set('token', token)

  return NextResponse.redirect(redirectUrl)
}