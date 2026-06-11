import {
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
  User
} from "lucide-react"
import { useEffect, useState } from "react"



import { Badge } from "~components/ui/badge"
import { Button } from "~components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~components/ui/card"
import { Switch } from "~components/ui/switch"
import {
  clearAuthSession,
  loginWithWebsite,
  refreshAuthSession,
  type AuthSession
} from "~lib/auth"
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  type ExtensionSettings
} from "~lib/settings"
import { sendToFlowerServer } from "./lib/flower"
// Import For Style DO NOT REMOVE DESPITE APPEARING UNUSED AND WARING OTHERWISE CODE WILL BE FUCKED UP WITHOUT ANY STYLES
import "./style.css"
function IndexPopup() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [authError, setAuthError] = useState("")
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  // sujal
const [syncMessage, setSyncMessage] = useState("")
const [isSyncing, setIsSyncing] = useState(false)
  //sujal ko part end 
useEffect(() => {
    void getSettings().then(setSettings)
    void refreshAuthSession()
      .then(setAuthSession)
      .catch((error) => {
        setAuthError(
          error instanceof Error
            ? error.message
            : "Unable to verify saved login."
        )
      })
  }, [])

  const updateSettings = (nextSettings: ExtensionSettings) => {
    setSettings(nextSettings)
    void saveSettings(nextSettings)
  }

  const handleLogin = async () => {
    setAuthError("")
    setIsAuthenticating(true)

    try {
      const session = await loginWithWebsite()

      if (session) {
        setAuthSession(session)
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Login failed. Try again."
      )
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleLogout = async () => {
    setAuthError("")
    await clearAuthSession()
    setAuthSession(null)
  }

// sujal ko part 
const handleSyncToFlower = async () => {
  setIsSyncing(true)
  setSyncMessage("")

  try {
    const result = await sendToFlowerServer()
    setSyncMessage(result.message)
  } catch (error) {
    setSyncMessage("Failed to send local data.")
  } finally {
    setIsSyncing(false)
  }
}



// end here



  return (
    <div className="w-72 bg-background p-3 text-foreground">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {authSession ? (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-normal">
              Pragya Lekh
            </h1>
            {authSession ? (
              <p className="truncate text-xs text-muted-foreground">
                {authSession.user?.email ||
                  authSession.user?.name ||
                  "Signed in"}
              </p>
            ) : null}
          </div>
        </div>
        <Badge className="gap-1 border-primary/25 bg-primary/10 text-primary">
          <ShieldCheck className="h-3.5 w-3.5" />
          Local
        </Badge>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            Assistance
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Enabled</span>
            <Switch
              aria-label="Enable extension"
              checked={settings.enabled}
              onChange={(event) =>
                updateSettings({
                  ...settings,
                  enabled: event.currentTarget.checked
                })
              }
            />
          </label>
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Typed text is read only in the current page and is not sent to a
            server.
          </div>
        </CardContent>
      </Card>

      <Card className="mt-3">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0">
          {authSession ? (
            <>
              <div className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
                Logged in. API calls will use your verified access token.
              </div>
              <Button onClick={handleLogout} type="button" variant="secondary">
                <LogOut className="h-4 w-4" />
                Log out
              </Button>
            </>
          ) : (
            <Button
              disabled={isAuthenticating}
              onClick={handleLogin}
              type="button">
              {isAuthenticating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              Login
            </Button>
          )}
          {authError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
              {authError}
            </div>
          ) : null}
        </CardContent>
      </Card>
{/* sujal ko part hai onnx  a big space here*/}










<Card className="mt-3">
  <CardHeader className="p-4 pb-2">
    <CardTitle className="flex items-center gap-2">
      <ShieldCheck className="h-4 w-4 text-primary" />
      Federated Sync
    </CardTitle>
  </CardHeader>

  <CardContent className="grid gap-3 p-4 pt-0">
    <Button
      disabled={isSyncing}
      onClick={handleSyncToFlower}
      type="button"
      variant="secondary">
      {isSyncing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ShieldCheck className="h-4 w-4" />
      )}

      Send Local Data
    </Button>

    {syncMessage ? (
      <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        {syncMessage}
      </div>
    ) : null}
  </CardContent>
</Card>





{/* end here also a big spave hai */}
















    </div>
  )
}

export default IndexPopup
