'use client'

import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Loader2,
  LockKeyhole,
  Mail,
  User,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { authClient } from '@/lib/auth-client'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const isExtensionLogin = searchParams.get('source') === 'extension'
  const searchMode =
    searchParams.get('mode') === 'signup' ? 'signup' : 'signin'

  const { data: session, isPending } = authClient.useSession()

  const [mode, setMode] = useState<'signin' | 'signup'>(searchMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hasRedirected = useRef(false)

  const title = useMemo(
    () => (mode === 'signin' ? 'Log in to console' : 'Create console access'),
    [mode],
  )

  useEffect(() => {
    if (isPending || !session?.user || hasRedirected.current) return

    hasRedirected.current = true

    if (isExtensionLogin) {
      window.location.assign('/api/extension/auth-callback')
      return
    }

    router.replace('/dashboard')
  }, [isExtensionLogin, isPending, router, session?.user])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setIsSubmitting(true)

    const result =
      mode === 'signin'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name })

    setIsSubmitting(false)

    if (result.error) {
      setError(result.error.message ?? 'Authentication failed')
      return
    }

    hasRedirected.current = true

    if (isExtensionLogin) {
      window.location.assign('/api/extension/auth-callback')
      return
    }

    router.replace('/dashboard')
  }

  if (isPending || session?.user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f8f3] text-[#17211c]">
        <Loader2 className="size-6 animate-spin text-[#1f7159]" />
      </main>
    )
  }

  return (
    <main className="grid min-h-screen bg-[#f7f8f3] text-[#17211c] lg:grid-cols-[0.92fr_1.08fr]">
      <section className="flex min-h-[44vh] flex-col justify-between border-b border-[#17211c]/10 bg-[#17211c] p-6 text-[#f7f8f3] lg:min-h-screen lg:border-b-0 lg:border-r lg:p-10">
        <Link
          href="/"
          className="flex w-fit items-center gap-2 text-sm text-[#c8d5ce]"
        >
          <ArrowLeft className="size-4" />
          Home
        </Link>

        <div className="max-w-xl py-16 lg:py-0">
          <div className="mb-6 flex size-14 items-center justify-center rounded-lg bg-[#edb241] text-2xl font-semibold text-[#17211c]">
            न
          </div>

          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
            Secure access for Nepali prediction.
          </h1>

          <p className="mt-5 max-w-lg leading-7 text-[#c8d5ce]">
            Use the same account for dashboard operations and token issuance.
            Admin permissions and service tier are attached to your
            authenticated user record.
          </p>
        </div>

        <div className="grid gap-3 text-sm text-[#c8d5ce] sm:grid-cols-3 lg:grid-cols-1">
          <span>RBAC: user/admin</span>
          <span>Service: free/pro/max</span>
          <span>JWT handoff</span>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-[#17211c]/10 bg-white p-6 shadow-xl shadow-[#17211c]/5">
            <div className="mb-6">
              <p className="text-sm font-medium text-[#1f7159]">Pragya Lekh</p>
              <h2 className="mt-2 text-3xl font-semibold">{title}</h2>
            </div>

            <div className="mb-6 grid grid-cols-2 rounded-md bg-[#eef2ec] p-1">
              <button
                type="button"
                onClick={() => setMode('signin')}
                className={`rounded px-3 py-2 text-sm font-medium transition ${
                  mode === 'signin' ? 'bg-white shadow-sm' : 'text-[#66746d]'
                }`}
              >
                Login
              </button>

              <button
                type="button"
                onClick={() => setMode('signup')}
                className={`rounded px-3 py-2 text-sm font-medium transition ${
                  mode === 'signup' ? 'bg-white shadow-sm' : 'text-[#66746d]'
                }`}
              >
                Sign up
              </button>
            </div>

            <form className="grid gap-4" onSubmit={handleSubmit}>
              {mode === 'signup' ? (
                <label className="grid gap-2 text-sm font-medium">
                  Name
                  <span className="flex items-center gap-2 rounded-md border border-[#17211c]/15 bg-[#f7f8f3] px-3 focus-within:ring-3 focus-within:ring-[#1f7159]/20">
                    <User className="size-4 text-[#66746d]" />
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      className="h-11 min-w-0 flex-1 bg-transparent outline-none"
                      placeholder="Dashboard user"
                    />
                  </span>
                </label>
              ) : null}

              <label className="grid gap-2 text-sm font-medium">
                Email
                <span className="flex items-center gap-2 rounded-md border border-[#17211c]/15 bg-[#f7f8f3] px-3 focus-within:ring-3 focus-within:ring-[#1f7159]/20">
                  <Mail className="size-4 text-[#66746d]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    className="h-11 min-w-0 flex-1 bg-transparent outline-none"
                    placeholder="you@example.com"
                  />
                </span>
              </label>

              <label className="grid gap-2 text-sm font-medium">
                Password
                <span className="flex items-center gap-2 rounded-md border border-[#17211c]/15 bg-[#f7f8f3] px-3 focus-within:ring-3 focus-within:ring-[#1f7159]/20">
                  <LockKeyhole className="size-4 text-[#66746d]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={8}
                    className="h-11 min-w-0 flex-1 bg-transparent outline-none"
                    placeholder="At least 8 characters"
                  />
                </span>
              </label>

              {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="h-11 rounded-md"
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                {mode === 'signin' ? 'Login' : 'Create account'}
              </Button>
            </form>
          </div>
        </div>
      </section>
    </main>
  )
}