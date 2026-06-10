const AUTH_STORAGE_KEY = "pragyaLekhAuthSession"

export type AuthUser = {
  email?: string
  id?: string
  name?: string
  role?: string
  serviceType?: string
}
export type AuthSession = {
  token: string
  tokenType: "Bearer"
  user?: AuthUser
}

const DEFAULT_AUTH_ME_URL = "http://localhost:3000/api/extension/me"
const DEFAULT_LOGIN_URL = "http://localhost:3000/login"

const getLoginUrl = () =>
  process.env.PLASMO_PUBLIC_AUTH_LOGIN_URL || DEFAULT_LOGIN_URL

const getAuthMeUrl = () =>
  process.env.PLASMO_PUBLIC_AUTH_ME_URL || DEFAULT_AUTH_ME_URL

const getDevAuthToken = () =>
  process.env.PLASMO_PUBLIC_DEV_AUTH_TOKEN?.trim() || ""

const hasChromeStorage = () =>
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local)

const hasChromeTabs = () =>
  typeof chrome !== "undefined" && Boolean(chrome.tabs)
export const getExtensionCallbackUrl = () =>
  chrome.runtime.getURL("tabs/auth-callback.html")

const DEFAULT_EXCHANGE_URL =
  "http://localhost:3000/api/auth/extension/exchange"

const getExchangeUrl = () =>
  process.env.PLASMO_PUBLIC_AUTH_EXCHANGE_URL || DEFAULT_EXCHANGE_URL

export const buildWebsiteLoginUrl = () => {
  const url = new URL(getLoginUrl())

  url.searchParams.set("source", "extension")
  url.searchParams.set("redirect_uri", getExtensionCallbackUrl())

  return url.toString()
}
console.log(getExtensionCallbackUrl())
export const createAuthSession = (token: string): AuthSession => ({
  token,
  tokenType: "Bearer"
})

const readAuthUser = async (session: AuthSession): Promise<AuthUser> => {
  const response = await fetch(getAuthMeUrl(), {
    headers: {
      Authorization: `${session.tokenType} ${session.token}`
    }
  })

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Authentication token is invalid or expired."
        : "Unable to verify your account."
    )
  }

  const data = (await response.json()) as { user?: AuthUser }

  if (!data.user) {
    throw new Error("Authentication response did not include a user.")
  }

  return data.user
}

export const verifyAuthSession = async (session: AuthSession) => ({
  ...session,
  user: await readAuthUser(session)
})

export const getAuthSession = async (): Promise<AuthSession | null> => {
  if (!hasChromeStorage()) {
    return null
  }

  const result = await chrome.storage.local.get(AUTH_STORAGE_KEY)

  return (result[AUTH_STORAGE_KEY] as AuthSession | undefined) ?? null
}

export const refreshAuthSession = async (): Promise<AuthSession | null> => {
  const session = await getAuthSession()

  if (!session) {
    return null
  }

  try {
    const verifiedSession = await verifyAuthSession(session)

    await saveAuthSession(verifiedSession)

    return verifiedSession
  } catch (error) {
    await clearAuthSession()
    throw error
  }
}

export const saveAuthSession = async (session: AuthSession) => {
  if (!hasChromeStorage()) {
    return
  }

  await chrome.storage.local.set({
    [AUTH_STORAGE_KEY]: session
  })
}

export const saveToken = async (token: string) => {
  const trimmedToken = token.trim()

  if (!trimmedToken) {
    throw new Error("Login callback did not include a token.")
  }

  const session = createAuthSession(trimmedToken)
  const verifiedSession = await verifyAuthSession(session)

  await saveAuthSession(verifiedSession)

  return verifiedSession
}

export const clearAuthSession = async () => {
  if (!hasChromeStorage()) {
    return
  }

  await chrome.storage.local.remove(AUTH_STORAGE_KEY)
}

export const loginWithWebsite = async (): Promise<AuthSession | null> => {
  const devAuthToken = getDevAuthToken()

  if (devAuthToken) {
    return saveToken(devAuthToken)
  }

  if (!hasChromeTabs()) {
    throw new Error("Chrome tabs API is unavailable.")
  }

  await chrome.tabs.create({
    active: true,
    url: buildWebsiteLoginUrl()
  })

  return null
}

export const authenticatedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
) => {
  const session = await getAuthSession()

  if (!session) {
    throw new Error("User is not logged in.")
  }

  const headers = new Headers(init.headers)

  headers.set("Authorization", `${session.tokenType} ${session.token}`)

  return fetch(input, {
    ...init,
    headers
  })
}


export const exchangeCodeForSession = async (code: string) => {
  const response = await fetch(getExchangeUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code })
  })

  if (!response.ok) {
    throw new Error("Unable to exchange login code.")
  }

  const data = (await response.json()) as { token?: string }

  if (!data.token) {
    throw new Error("Exchange response did not include token.")
  }

  return saveToken(data.token)
}