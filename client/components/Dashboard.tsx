'use client'

import { getUsers } from '@/actions/users'
import { getUserStats, getAllUsersStats } from '@/actions/stats'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Crown,
  CreditCard,
  LogOut,
  Shield,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { AdminUser, ConsoleUser } from '@/lib/types'
import { UserStatusPanel } from './dashboard/UserStatusPanel'
import { AdminUsersPanel } from './dashboard/AdminUserPanel'



const tierCopy = {
  free: 'Starter access for prediction and correction features.',
  pro: 'Higher usage allowance, exports, and priority processing.',
  max: 'Full team visibility, fleet controls, and the highest usage allowance.',
}

export default function DashboardPage() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()

  const [users, setUsers] = useState<AdminUser[]>([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [userLoadError, setUserLoadError] = useState('')
  const [stats, setStats] = useState({ predictionsCount: 0, correctionsCount: 0, errorsDetected: 0 })
  const [allUsersStats, setAllUsersStats] = useState<Awaited<ReturnType<typeof getAllUsersStats>>>([])


  const user = session?.user as ConsoleUser | undefined
  const role = user?.role ?? 'user'
  const serviceType = user?.serviceType ?? 'free'
  const isPaid = Boolean(user?.paid)
  const isAdmin = role === 'admin'

  useEffect(() => {
    if (!isPending && !user) {
      router.replace('/login')
    }
  }, [isPending, router, user])

  useEffect(() => {
    if (isPending || !user?.id) return
    void getUserStats(user.id).then(setStats)
  }, [isPending, user])

  useEffect(() => {
    if (isPending || !session?.user || !isAdmin) return

    let isCurrent = true

    async function loadUsers() {
      setIsLoadingUsers(true)
      setUserLoadError('')

      try {
        const result = await getUsers()

        if (!isCurrent) return

        setUsers(result as AdminUser[])
        setTotalUsers(result.length)
      } catch {
        if (!isCurrent) return
        setUserLoadError('Could not load users')
      } finally {
        if (isCurrent) {
          setIsLoadingUsers(false)
        }
      }
    }

    void loadUsers()
    void getAllUsersStats().then(setAllUsersStats)

    return () => {
      isCurrent = false
    }
  }, [isAdmin, isPending, session?.user])

  if (isPending || !user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f8f3] text-[#17211c]">
        <Activity className="size-6 animate-pulse text-[#1f7159]" />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f7f8f3] text-[#17211c]">
      <header className="border-b border-[#17211c]/10 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-[#526159]"
          >
            <ArrowLeft className="size-4" />
            Landing
          </Link>

          <Button
            variant="outline"
            className="rounded-md"
            onClick={() => {
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    router.replace('/')
                  },
                },
              })
            }}
          >
            <LogOut />
            Sign out
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-[1fr_0.72fr]">
          <div className="rounded-lg border border-[#17211c]/10 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-[#1f7159]">
              Authenticated dashboard
            </p>

            <h1 className="mt-2 text-4xl font-semibold">
              {user.name ?? user.email}
            </h1>

            <p className="mt-3 max-w-2xl leading-7 text-[#526159]">
              View your account status, service tier, and Pragya Lekh activity
              from one place.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-2 rounded-md bg-[#e8f2ee] px-3 py-2 text-sm font-medium text-[#1f7159]">
                <Shield className="size-4" />
                {role}
              </span>

              <span className="inline-flex items-center gap-2 rounded-md bg-[#fff4d7] px-3 py-2 text-sm font-medium text-[#7a4c00]">
                <Crown className="size-4" />
                {serviceType}
              </span>

              <span className="inline-flex items-center gap-2 rounded-md bg-[#f0eee7] px-3 py-2 text-sm font-medium text-[#665742]">
                <BadgeCheck className="size-4" />
                {user.emailVerified ? 'verified' : 'unverified'}
              </span>

              <span
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  isPaid
                    ? 'bg-[#17211c] text-[#edb241]'
                    : 'bg-[#eef2ec] text-[#526159]'
                }`}
              >
                <CreditCard className="size-4" />
                {isPaid ? 'paid user' : 'unpaid'}
              </span>
            </div>
          </div>

          <div
            className={`rounded-lg border p-6 shadow-sm ${
              isPaid
                ? 'border-[#edb241]/60 bg-[#17211c] text-[#f7f8f3] shadow-[#edb241]/15'
                : 'border-[#17211c]/10 bg-[#17211c] text-[#f7f8f3]'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <Zap className="size-6 text-[#edb241]" />

              {isPaid ? (
                <span className="rounded-md bg-[#edb241] px-3 py-1 text-sm font-semibold text-[#17211c]">
                  Active paid access
                </span>
              ) : null}
            </div>

            <h2 className="mt-4 text-2xl font-semibold">
              {serviceType.toUpperCase()} service
            </h2>

            <p className="mt-3 leading-7 text-[#c8d5ce]">
              {isPaid
                ? 'Your paid access is active. Premium prediction and correction features are enabled.'
                : tierCopy[serviceType]}
            </p>

            <Button
              type="button"
              className={`mt-6 h-11 rounded-md px-5 ${
                isPaid
                  ? 'border border-[#edb241]/40 bg-transparent text-[#edb241] hover:bg-[#edb241]/10'
                  : 'bg-[#edb241] text-[#17211c] hover:bg-[#f1bf62]'
              }`}
              onClick={() => undefined}
            >
              {isPaid ? <BadgeCheck /> : <CreditCard />}
              {isPaid ? 'Paid' : 'Pay'}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {[
            ['Predictions', String(stats.predictionsCount), 'Words predicted by ONNX model'],
            ['Errors detected', String(stats.errorsDetected), 'Spelling errors found'],
            ['Corrections', String(stats.correctionsCount), 'Words corrected'],
          ].map(([label, value, body]) => (
            <article
              key={label}
              className="rounded-lg border border-[#17211c]/10 bg-white p-5 shadow-sm"
            >
              <BadgeCheck className="size-5 text-[#1f7159]" />
              <p className="mt-5 text-3xl font-semibold">{value}</p>
              <h2 className="mt-2 font-medium">{label}</h2>
              <p className="mt-2 text-sm leading-6 text-[#526159]">{body}</p>
            </article>
          ))}
        </div>

        {isAdmin ? (
          <AdminUsersPanel
            isLoading={isLoadingUsers}
            totalUsers={totalUsers}
            users={users}
            error={userLoadError}
            usersStats={allUsersStats}
          />
        ) : (
          <UserStatusPanel user={user} serviceType={serviceType} />
        )}
      </section>
    </main>
  )
}








