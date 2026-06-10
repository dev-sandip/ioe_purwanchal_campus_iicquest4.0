import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db"; // your drizzle instance
import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins/admin'
import { bearer } from 'better-auth/plugins/bearer'
import { jwt } from 'better-auth/plugins/jwt'
import * as schema  from '@/db/schema'
export const auth = betterAuth({
  appName: 'Pragya Lekh',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'user',
        input: false,
      },
      serviceType: {
        type: 'string',
        required: true,
        defaultValue: 'free',
        input: false,
      },
      paid: {
        type: 'boolean',
        required: true,
        defaultValue: false,
        input: false,
      },
    },
  },
  plugins: [
    admin({
      adminRoles: ['admin'],
      defaultRole: 'user',
    }),
    bearer(),
    jwt({
      jwt: {
        audience: 'pragya-lekh-browser-extension',
        expirationTime: '7 days',
        definePayload: ({ user, session }) => ({
          email: user.email,
          name: user.name,
          role: user.role,
          serviceType: user.serviceType,
          paid: user.paid,
          sessionId: session.id,
        }),
      },
    }),
  ],
})
