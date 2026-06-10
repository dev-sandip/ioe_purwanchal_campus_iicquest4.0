import { buttonVariants } from '@/components/ui/button'
import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Brain,
  CheckCircle2,
  Languages,
  LockKeyhole,
  Network,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

const metrics = [
  ['On-device', 'training loop'],
  ['Nepali', 'correction layer'],
  ['RBAC', 'admin controls'],
]

const capabilities = [
  {
    icon: Brain,
    title: 'Next-word prediction',
    body: 'Track model quality, accepted suggestions, and privacy-preserving updates from enrolled browsers.',
  },
  {
    icon: Languages,
    title: 'Nepali word correction',
    body: 'Review correction confidence, dictionary coverage, and model drift for Nepali typing workflows.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Raw text stays in the browser. The dashboard observes aggregate signals and service eligibility.',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f7f8f3] text-[#17211c]">
      <section className="relative overflow-hidden border-b border-[#17211c]/10">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(31,113,89,0.14),transparent_42%),radial-gradient(circle_at_78%_20%,rgba(237,178,65,0.2),transparent_30%)]" />

        <div className="relative mx-auto grid min-h-[92vh] max-w-7xl gap-10 px-5 py-6 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:px-10">
          <nav className="col-span-full flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 font-semibold">
              <span className="grid size-9 place-items-center rounded-md bg-[#17211c] text-[#f7f8f3]">
                न
              </span>
              <span>Pragya Lekh</span>
            </Link>

            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className={buttonVariants({ variant: 'ghost', size: 'lg' })}
              >
                Login
              </Link>

              <Link
                href="/login?mode=signup"
                className={buttonVariants({ size: 'lg' })}
              >
                Start
                <ArrowRight data-icon="inline-end" />
              </Link>
            </div>
          </nav>

          <div className="flex max-w-3xl flex-col justify-center pb-10 pt-8 lg:pb-24">
            <div className="mb-8 flex w-fit items-center gap-2 rounded-md border border-[#1f7159]/30 bg-white/70 px-3 py-2 text-sm text-[#1f7159] shadow-sm backdrop-blur">
              <Network className="size-4" />
              Privacy-first dashboard for browser intelligence
            </div>

            <h1 className="max-w-4xl text-5xl font-semibold leading-[0.98] tracking-normal text-[#17211c] sm:text-7xl lg:text-8xl">
              Private Nepali typing intelligence, measured from one console.
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-[#415149]">
              Manage users, service tiers, model telemetry, and login for a
              browser extension that predicts the next word and corrects Nepali
              text without centralizing private writing.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/login"
                className={buttonVariants({
                  size: 'lg',
                  className: 'h-11 rounded-md px-5',
                })}
              >
                Open dashboard
                <ArrowRight data-icon="inline-end" />
              </Link>

              <Link
                href="/login?source=extension"
                className={buttonVariants({
                  variant: 'outline',
                  size: 'lg',
                  className:
                    'h-11 rounded-md border-[#17211c]/20 bg-white/60 px-5',
                })}
              >
                Login
                <LockKeyhole data-icon="inline-end" />
              </Link>
            </div>
          </div>

          <div className="flex items-center pb-12 lg:pb-24">
            <div className="w-full rounded-lg border border-[#17211c]/10 bg-[#111a16] p-3 shadow-2xl shadow-[#1f7159]/20">
              <div className="rounded-md border border-white/10 bg-[#17211c] p-4 text-[#f7f8f3]">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-sm text-[#b9c9c0]">
                      Live extension mesh
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">
                      Prediction health
                    </h2>
                  </div>

                  <span className="rounded-md bg-[#edb241] px-3 py-1 text-sm font-medium text-[#17211c]">
                    pro
                  </span>
                </div>

                <div className="grid gap-3 py-4 sm:grid-cols-3">
                  {metrics.map(([value, label]) => (
                    <div
                      key={value}
                      className="rounded-md border border-white/10 bg-white/4 p-3"
                    >
                      <p className="text-xl font-semibold">{value}</p>
                      <p className="mt-1 text-sm text-[#b9c9c0]">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-md bg-[#f7f8f3] p-4 text-[#17211c]">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="size-4 text-[#1f7159]" />
                      <span className="font-medium">Round 42 aggregation</span>
                    </div>
                    <span className="text-sm text-[#66746d]">83% complete</span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-[#d8ddd5]">
                    <div className="h-full w-[83%] rounded-full bg-[#1f7159]" />
                  </div>

                  <div className="mt-5 grid gap-2">
                    {[
                      'Corrected: विद्यालय',
                      'Predicted: अध्ययन',
                      'Updated: free tier cap',
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-center gap-2 rounded-md border border-[#17211c]/10 bg-white px-3 py-2 text-sm"
                      >
                        <CheckCircle2 className="size-4 text-[#1f7159]" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-16 sm:px-8 md:grid-cols-3 lg:px-10">
        {capabilities.map((item) => (
          <article
            key={item.title}
            className="rounded-lg border border-[#17211c]/10 bg-white p-6 shadow-sm"
          >
            <item.icon className="size-6 text-[#1f7159]" />
            <h2 className="mt-5 text-xl font-semibold">{item.title}</h2>
            <p className="mt-3 leading-7 text-[#526159]">{item.body}</p>
          </article>
        ))}
      </section>

      <section className="border-y border-[#17211c]/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:px-10">
          <div>
            <Sparkles className="size-6 text-[#ed8f2f]" />
            <h2 className="mt-4 text-3xl font-semibold">
              Built for secure auth and tier-aware APIs.
            </h2>
          </div>

          <div className="grid gap-3 text-sm text-[#415149] sm:grid-cols-3">
            {[
              'Login at /login',
              'Return required data from the app session',
              'Call APIs with Authorization bearer tokens',
            ].map((step) => (
              <div
                key={step}
                className="flex items-start gap-2 rounded-md bg-[#f7f8f3] p-4"
              >
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[#1f7159]" />
                {step}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}