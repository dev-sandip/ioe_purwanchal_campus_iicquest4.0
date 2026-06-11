'use server'

import { db } from '@/db'
import { usageStats, user } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function getUserStats(userId: string) {
  const stats = await db.query.usageStats.findFirst({
    where: eq(usageStats.userId, userId),
  })

  return stats ?? {
    predictionsCount: 0,
    correctionsCount: 0,
    errorsDetected: 0,
  }
}

export async function getAllUsersStats() {
  return db
    .select({
      userId: usageStats.userId,
      name: user.name,
      email: user.email,
      predictionsCount: usageStats.predictionsCount,
      correctionsCount: usageStats.correctionsCount,
      errorsDetected: usageStats.errorsDetected,
      updatedAt: usageStats.updatedAt,
    })
    .from(usageStats)
    .innerJoin(user, eq(usageStats.userId, user.id))
}
