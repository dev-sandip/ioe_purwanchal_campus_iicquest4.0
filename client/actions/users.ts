'use server'

import { db } from '@/db'
import { user } from '@/db/schema'

export async function getUsers() {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      serviceType: user.serviceType,
      paid: user.paid,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
   
}