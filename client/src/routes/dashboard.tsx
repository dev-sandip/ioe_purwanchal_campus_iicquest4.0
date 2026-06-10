import { Button, buttonVariants } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'
import { createFileRoute, Link,Navigate } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Crown,
  CreditCard,
  LogOut,
  Shield,
  Users,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/dashboard')({ component: Dashboard })

type ConsoleUser = {
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

type AdminUser = ConsoleUser & {
  id: string
  name: string
  email: string
  createdAt: Date | string
  updatedAt: Date | string
}

const tierCopy = {
  free: 'Starter access for prediction and correction features.',
  pro: 'Higher usage allowance, exports, and priority processing.',
  max: 'Full team visibility, fleet controls, and the highest usage allowance.',
}

function Dashboard() {
  const { data: session, isPending } = authClient.useSession()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [userLoadError, setUserLoadError] = useState('')
  const [updatingPaymentUserId, setUpdatingPaymentUserId] = useState('')

  const user = session?.user as ConsoleUser | undefined
  const role = user?.role ?? 'user'
  const serviceType = user?.serviceType ?? 'free'
  const isPaid = Boolean(user?.paid)
  const isAdmin = role === 'admin'

  useEffect(() => {
    if (isPending || !session?.user || !isAdmin) return

    let isCurrent = true

    async function loadUsers() {
      setIsLoadingUsers(true)
      setUserLoadError('')

      const result = await authClient.admin.listUsers({
        query: {
          limit: 50,
          sortBy: 'createdAt',
          sortDirection: 'desc',
        },
      })

      if (!isCurrent) return

      setIsLoadingUsers(false)

      if (result.error) {
        setUserLoadError(result.error.message ?? 'Could not load users')
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      setUsers((result.data.users ?? []) as AdminUser[])
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      setTotalUsers(result.data.total ?? 0)
    }

    void loadUsers()

    return () => {
      isCurrent = false
    }
  }, [isAdmin, isPending, session?.user])

  async function handleTogglePayment(targetUser: AdminUser) {
    setUpdatingPaymentUserId(targetUser.id)
    setUserLoadError('')

    const nextPaid = !targetUser.paid
    const result = await authClient.admin.updateUser({
      userId: targetUser.id,
      data: {
        paid: nextPaid,
      },
    })

    setUpdatingPaymentUserId('')

    if (result.error) {
      setUserLoadError(
        result.error.message ?? 'Could not update payment status',
      )
      return
    }

    setUsers((currentUsers) =>
      currentUsers.map((item) =>
        item.id === targetUser.id
          ? {
              ...item,
              paid: nextPaid,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    )
  }

  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f8f3] text-[#17211c]">
        <Activity className="size-6 animate-pulse text-[#1f7159]" />
      </main>
    )
  }

if (!user) {
  return <Navigate to="/login" />
}

  return (
    <main className="min-h-screen bg-[#f7f8f3] text-[#17211c]">
      <header className="border-b border-[#17211c]/10 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <Link
            to="/"
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
                    window.location.href = '/'
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
            ['Next-word acceptance', '68%', 'Accepted suggestions this week'],
            ['Nepali corrections', '1.8k', 'Weekly accepted corrections'],
            ['Training rounds', '42', 'Latest model aggregation cycle'],
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
            updatingPaymentUserId={updatingPaymentUserId}
            onTogglePayment={handleTogglePayment}
          />
        ) : (
          <UserStatusPanel user={user} serviceType={serviceType} />
        )}
      </section>
    </main>
  )
}

function UserStatusPanel({
  user,
  serviceType,
}: {
  user: ConsoleUser
  serviceType: NonNullable<ConsoleUser['serviceType']>
}) {
  return (
    <div
      className={`mt-5 rounded-lg border p-5 shadow-sm ${
        user.paid
          ? 'border-[#edb241]/50 bg-[#fffaf0]'
          : 'border-[#17211c]/10 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Account status</h2>
        {user.paid ? (
          <span className="inline-flex items-center gap-2 rounded-md bg-[#17211c] px-3 py-2 text-sm font-medium text-[#edb241]">
            <BadgeCheck className="size-4" />
            Paid access enabled
          </span>
        ) : null}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile label="Service" value={serviceType} />
        <StatusTile
          label="Payment"
          value={user.paid ? 'Paid' : 'Unpaid'}
          tone={user.paid ? 'paid' : 'default'}
        />
        <StatusTile
          label="Email"
          value={user.emailVerified ? 'Verified' : 'Unverified'}
        />
        <StatusTile label="Access" value={user.banned ? 'Blocked' : 'Active'} />
        <StatusTile
          label="Joined"
          value={formatDate(user.createdAt) ?? 'Not available'}
        />
      </div>
    </div>
  )
}

function AdminUsersPanel({
  users,
  totalUsers,
  isLoading,
  error,
  updatingPaymentUserId,
  onTogglePayment,
}: {
  users: AdminUser[]
  totalUsers: number
  isLoading: boolean
  error: string
  updatingPaymentUserId: string
  onTogglePayment: (user: AdminUser) => void
}) {
  return (
    <div className="mt-5 rounded-lg border border-[#17211c]/10 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#17211c]/10 p-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[#1f7159]">
            <Users className="size-4" />
            Admin
          </div>
          <h2 className="mt-2 text-2xl font-semibold">Users and status</h2>
        </div>
        <span className="rounded-md bg-[#eef2ec] px-3 py-2 text-sm font-medium text-[#526159]">
          {totalUsers} total
        </span>
      </div>

      {error ? (
        <p className="m-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-245 border-collapse text-left text-sm">
          <thead className="bg-[#f7f8f3] text-[#526159]">
            <tr>
              {[
                'User',
                'Role',
                'Service',
                'Payment',
                'Email',
                'Access',
                'Created',
                'Updated',
                'Action',
              ].map((heading) => (
                <th key={heading} className="px-5 py-3 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-5 py-6 text-[#526159]" colSpan={8}>
                 No Users Found
                </td>
              </tr>
            ) : null}

            {!isLoading && users.length === 0 ? (
              <tr>
                <td className="px-5 py-6 text-[#526159]" colSpan={8}>
                  No users found.
                </td>
              </tr>
            ) : null}

            {users.map((item) => (
              <tr
                key={item.id}
                className="border-t border-[#17211c]/10 align-top"
              >
                <td className="px-5 py-4">
                  <p className="font-medium text-[#17211c]">{item.name}</p>
                  <p className="mt-1 text-[#526159]">{item.email}</p>
                </td>
                <td className="px-5 py-4">
                  <Pill tone={item.role === 'admin' ? 'green' : 'neutral'}>
                    {item.role ?? 'user'}
                  </Pill>
                </td>
                <td className="px-5 py-4">
                  <Pill tone="gold">{item.serviceType ?? 'free'}</Pill>
                </td>
                <td className="px-5 py-4">
                  <Pill tone={item.paid ? 'green' : 'neutral'}>
                    {item.paid ? 'paid' : 'unpaid'}
                  </Pill>
                </td>
                <td className="px-5 py-4">
                  <Pill tone={item.emailVerified ? 'green' : 'neutral'}>
                    {item.emailVerified ? 'verified' : 'unverified'}
                  </Pill>
                </td>
                <td className="px-5 py-4">
                  <Pill tone={item.banned ? 'red' : 'green'}>
                    {item.banned ? 'blocked' : 'active'}
                  </Pill>
                  {item.banReason ? (
                    <p className="mt-2 max-w-48 text-xs leading-5 text-[#526159]">
                      {item.banReason}
                    </p>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-[#526159]">
                  {formatDate(item.createdAt)}
                </td>
                <td className="px-5 py-4 text-[#526159]">
                  {formatDate(item.updatedAt)}
                </td>
                <td className="px-5 py-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-md"
                    disabled={updatingPaymentUserId === item.id}
                    onClick={() => onTogglePayment(item)}
                  >
                    {item.paid ? 'Mark unpaid' : 'Mark paid'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusTile({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'paid'
}) {
  return (
    <div
      className={`rounded-md border p-4 ${
        tone === 'paid'
          ? 'border-[#edb241]/50 bg-[#17211c] text-[#f7f8f3]'
          : 'border-[#17211c]/10 bg-[#f7f8f3] text-[#17211c]'
      }`}
    >
      <p
        className={`text-sm ${
          tone === 'paid' ? 'text-[#edb241]' : 'text-[#526159]'
        }`}
      >
        {label}
      </p>
      <p className="mt-2 font-semibold capitalize">{value}</p>
    </div>
  )
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'green' | 'gold' | 'red' | 'neutral'
}) {
  const tones = {
    green: 'bg-[#e8f2ee] text-[#1f7159]',
    gold: 'bg-[#fff4d7] text-[#7a4c00]',
    red: 'bg-red-50 text-red-700',
    neutral: 'bg-[#eef2ec] text-[#526159]',
  }

  return (
    <span
      className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium capitalize ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return null

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}
