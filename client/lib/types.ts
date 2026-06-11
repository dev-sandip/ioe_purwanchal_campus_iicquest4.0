export type ConsoleUser = {
  id?: string
  name?: string
  email?: string
  emailVerified?: boolean
  role?: 'user' | 'admin'
  serviceType?: 'free' | 'pro' | 'max'
  paid?: boolean
  banned?: boolean | null
  banReason?: string | null
  banExpires?: Date | string | null
  createdAt?: Date | string
  updatedAt?: Date | string
}

export type AdminUser = ConsoleUser & {
  id: string
  name: string
  email: string
  createdAt: Date | string
  updatedAt: Date | string
}