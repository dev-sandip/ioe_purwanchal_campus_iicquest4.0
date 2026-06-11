import { auth } from '@/lib/auth'
import { db } from '@/db'
import { usageStats } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null

  try {
    const { payload } = await auth.api.verifyJWT({ body: { token } })
    return payload?.sub ?? null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    predictions?: number
    corrections?: number
    errorsDetected?: number
  }

  const existing = await db.query.usageStats.findFirst({
    where: eq(usageStats.userId, userId),
  })

  if (existing) {
    await db
      .update(usageStats)
      .set({
        predictionsCount: existing.predictionsCount + (body.predictions ?? 0),
        correctionsCount: existing.correctionsCount + (body.corrections ?? 0),
        errorsDetected: existing.errorsDetected + (body.errorsDetected ?? 0),
        updatedAt: new Date(),
      })
      .where(eq(usageStats.userId, userId))
  } else {
    await db.insert(usageStats).values({
      userId,
      predictionsCount: body.predictions ?? 0,
      correctionsCount: body.corrections ?? 0,
      errorsDetected: body.errorsDetected ?? 0,
    })
  }

  return NextResponse.json({ success: true })
}

export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stats = await db.query.usageStats.findFirst({
    where: eq(usageStats.userId, userId),
  })

  return NextResponse.json({
    stats: stats ?? {
      predictionsCount: 0,
      correctionsCount: 0,
      errorsDetected: 0,
    },
  })
}
