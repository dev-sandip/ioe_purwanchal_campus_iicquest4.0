import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    return NextResponse.json(
      { error: 'Missing Authorization: Bearer token' },
      { status: 401 },
    )
  }

  const { payload } = await auth.api.verifyJWT({
    body: { token },
  })

  if (!payload) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  return NextResponse.json({
    user: {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      serviceType: payload.serviceType,
      paid: payload.paid,
    },
  })
}