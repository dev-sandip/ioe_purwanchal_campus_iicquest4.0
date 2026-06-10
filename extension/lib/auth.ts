const AUTH_STORAGE_KEY = "pragyaLekhAuthSession"

// Set this during local development to bypass the website login flow.
// Example: const DEV_AUTH_TOKEN = "eyJhbGciOi..."
const DEV_AUTH_TOKEN = "sandipishandsome"

export type AuthSession = {
  token: string
  tokenType: "Bearer"
}

const DEFAULT_LOGIN_URL = "https://yourdomain.com/login"

const getLoginUrl = () =>
  process.env.PLASMO_PUBLIC_AUTH_LOGIN_URL || DEFAULT_LOGIN_URL

const hasChromeStorage = () =>
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local)

const hasChromeTabs = () =>
  typeof chrome !== "undefined" && Boolean(chrome.tabs)

export const getExtensionCallbackUrl = () =>
  chrome.runtime.getURL("tabs/auth-callback.html")

export const buildWebsiteLoginUrl = () => {
  const url = new URL(getLoginUrl())

  url.searchParams.set("source", "extension")

  return url.toString()
}

export const createAuthSession = (token: string): AuthSession => ({
  token,
  tokenType: "Bearer"
})

export const getAuthSession = async (): Promise<AuthSession | null> => {
  if (!hasChromeStorage()) {
    return null
  }

  const result = await chrome.storage.local.get(AUTH_STORAGE_KEY)

  return (result[AUTH_STORAGE_KEY] as AuthSession | undefined) ?? null
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

  await saveAuthSession(session)

  return session
}

export const clearAuthSession = async () => {
  if (!hasChromeStorage()) {
    return
  }

  await chrome.storage.local.remove(AUTH_STORAGE_KEY)
}

export const loginWithWebsite = async (): Promise<AuthSession | null> => {
  if (DEV_AUTH_TOKEN) {
    return saveToken(DEV_AUTH_TOKEN)
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
