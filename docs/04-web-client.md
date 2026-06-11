# 04 — Web Client

The web client is a **Next.js 16** (App Router) application using **React 19**,
**better-auth** for authentication, **Drizzle ORM** over **PostgreSQL** (`pg`),
Tailwind CSS, and shadcn/ui components. Package name: `frontend`.

## Directory Map

```
client/
├── app/
│   ├── page.tsx                 # Home (renders HomePage)
│   ├── layout.tsx               # Root layout, fonts
│   ├── login/page.tsx           # Login (renders LoginPage in Suspense)
│   ├── dashboard/page.tsx       # Dashboard (renders Dashboard)
│   ├── demo/page.tsx            # Simple Nepali textarea demo
│   └── api/
│       ├── auth/[...all]/route.ts          # better-auth handler
│       └── extension/
│           ├── me/route.ts                  # Verify JWT → return user
│           ├── stats/route.ts               # GET/POST usage stats
│           └── auth-callback/route.ts       # Issue token → redirect to extension
├── components/
│   ├── HomePage.tsx
│   ├── LoginPage.tsx
│   ├── Dashboard.tsx
│   ├── dashboard/               # AdminUserPanel, UserStatusPanel, StatusTile, Pill
│   └── ui/                      # shadcn/ui primitives
├── actions/
│   ├── users.ts                 # getUsers()
│   └── stats.ts                 # getUserStats(), getAllUsersStats()
├── db/
│   ├── schema.ts                # Drizzle schema
│   └── index.ts                 # Drizzle client (node-postgres)
├── drizzle/                     # SQL migrations + meta
├── lib/
│   ├── auth.ts                  # better-auth server config
│   ├── auth-client.ts           # better-auth React client
│   ├── types.ts                 # ConsoleUser / AdminUser types
│   └── utils.ts                 # cn() helper
├── middleware.ts                # CORS for /api/*
└── drizzle.config.ts            # Drizzle Kit config
```

## Authentication (`lib/auth.ts`)

better-auth is configured with:

- `appName: "Pragya Lekh"`
- **Drizzle adapter** (`provider: "pg"`) using the shared schema.
- **Email & password** sign-in enabled.
- **Additional user fields** (server-set, not user-input): `role`,
  `serviceType`, `paid`.
- **Plugins:**
  - `admin({ adminRoles: ['admin'], defaultRole: 'user' })`
  - `bearer()` — accept Bearer tokens.
  - `jwt(...)` — issues JWTs with:
    - audience `pragya-lekh-browser-extension`
    - expiration `7 days`
    - payload: `email`, `name`, `role`, `serviceType`, `paid`, `sessionId`.

The React client (`lib/auth-client.ts`) is created with
`createAuthClient({ baseURL: process.env.NEXT_PUBLIC_BASE_URL })`.

## API Routes

### `POST/GET /api/auth/[...all]`
The better-auth catch-all handler (`toNextJsHandler(auth)`). Handles sign-in,
sign-up, session, JWT/JWKS, and admin operations.

### `GET /api/extension/me`
- Reads `Authorization: Bearer <token>`.
- Verifies with `auth.api.verifyJWT`.
- Returns `{ user: { id, email, name, role, serviceType, paid } }`
  (`id` is the JWT `sub`). Returns 401 on missing/invalid token.

### `GET/POST /api/extension/stats`
- Both methods resolve the user id from the Bearer JWT (`payload.sub`); 401 if
  absent/invalid.
- **POST** body `{ predictions?, corrections?, errorsDetected? }` upserts the
  user's `usage_stats` row (incrementing existing counts, or inserting a new
  row). Returns `{ success: true }`.
- **GET** returns the current `{ stats: { predictionsCount, correctionsCount,
  errorsDetected } }` (zeros if none).

### `GET /api/extension/auth-callback`
- Requires `CHROME_EXTENSION_ID` env (500 if missing).
- Calls `auth.api.getToken({ headers })` to mint a JWT for the current session.
- If no token (not logged in), redirects to `/login?source=extension`.
- Otherwise redirects to
  `chrome-extension://<CHROME_EXTENSION_ID>/tabs/auth-callback.html?token=<JWT>`.

### CORS (`middleware.ts`)
Matches `/api/:path*`. Answers `OPTIONS` preflight with 204 and permissive CORS
headers (`Access-Control-Allow-Origin: *`, common methods, `Content-Type` and
`Authorization` headers), and attaches the same headers to all other API
responses.

> **Security note:** CORS is wide-open (`*`) and intended for hackathon/demo
> convenience. For production, restrict the allowed origin to the extension and
> known front-ends.

## Pages & Components

### Home (`/`)
Renders `HomePage` — the landing/marketing page.

### Login (`/login`)
`LoginPage` handles both **sign in** and **sign up** (email/password via
better-auth). Behavior of note:
- Reads `?source=extension` and `?mode=signup` from the query string.
- After a successful auth (or if already signed in), if `source=extension` it
  navigates to `/api/extension/auth-callback` (which issues the token and
  redirects back into the extension); otherwise it goes to `/dashboard`.
- Password minimum length is 8.

### Dashboard (`/dashboard`)
`Dashboard` (client component) uses `authClient.useSession()`:
- Redirects to `/login` when not authenticated.
- Shows the user's role, service tier, verification, and paid status.
- Loads the user's usage stats via `getUserStats(user.id)` and shows three
  tiles: **Predictions**, **Errors detected**, **Corrections**.
- For **admins**, loads all users (`getUsers`) and all usage stats
  (`getAllUsersStats`) and renders `AdminUsersPanel`; non-admins see
  `UserStatusPanel`.

### Demo (`/demo`)
A simple Nepali textarea page prompting the user to install the extension and
type Nepali; detection happens via the installed extension's ONNX model.

## Server Actions

- `actions/users.ts` — `getUsers()` selects all users (id, name, email, role,
  serviceType, paid, banned, timestamps, etc.).
- `actions/stats.ts`:
  - `getUserStats(userId)` — the user's `usage_stats` row (or zeros).
  - `getAllUsersStats()` — usage stats joined with user name/email for the admin
    table.

## Database

The Drizzle schema and migrations are documented in
[10 — Data & Storage](./10-data-and-storage.md#postgresql-web-client). In short:
`user`, `session`, `account`, `verification`, `jwks`, and `usage_stats`, plus
the `user_role` (`user`/`admin`) and `service_type` (`free`/`pro`/`max`) enums.

The Drizzle client (`db/index.ts`) connects with
`drizzle(process.env.DATABASE_URL!, { schema })`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (Drizzle client + Kit) |
| `CHROME_EXTENSION_ID` | Used to build the extension callback redirect URL |
| `NEXT_PUBLIC_BASE_URL` | Base URL for the better-auth React client |

See [09 — Configuration](./09-configuration.md) for the full reference.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Next.js dev server (default `http://localhost:3000`) |
| `pnpm build` | Production build |
| `pnpm start` | Start the production server |
| `pnpm lint` | ESLint |

Drizzle migrations are managed with Drizzle Kit (config in `drizzle.config.ts`,
output to `./drizzle`).
