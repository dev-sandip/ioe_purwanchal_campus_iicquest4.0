import { CheckCircle2, XCircle } from "lucide-react"
import { useEffect, useState } from "react"

import "~style.css"

import { Card, CardContent, CardHeader, CardTitle } from "~components/ui/card"
import { saveToken } from "~lib/auth"

type CallbackStatus = "loading" | "success" | "error"

function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing login...")
  const [status, setStatus] = useState<CallbackStatus>("loading")

  useEffect(() => {
    const token = new URL(window.location.href).searchParams.get("token")

    void saveToken(token || "")
      .then(() => {
        setStatus("success")
        setMessage("Login complete. You can close this tab.")
      })
      .catch((error) => {
        setStatus("error")
        setMessage(
          error instanceof Error ? error.message : "Unable to complete login."
        )
      })
  }, [])

  const isSuccess = status === "success"
  const isError = status === "error"

  return (
    <main className="grid min-h-screen place-items-center bg-background p-4 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isSuccess ? (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            ) : isError ? (
              <XCircle className="h-5 w-5 text-red-600" />
            ) : (
              <span className="h-5 w-5 animate-pulse rounded-full bg-accent" />
            )}
            Pragya Lekh
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </main>
  )
}

export default AuthCallbackPage
