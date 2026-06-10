import { Globe2, ShieldCheck, Sparkles, SpellCheck2 } from "lucide-react"
import { useEffect, useState } from "react"

import "./style.css"

import { Badge } from "~components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "~components/ui/card"
import { Switch } from "~components/ui/switch"
import { getExtensionCallbackUrl } from "~lib/auth"
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  type ExtensionSettings
} from "~lib/settings"

type SettingRowProps = {
  checked: boolean
  description: string
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}

function SettingRow({
  checked,
  description,
  disabled,
  label,
  onChange
}: SettingRowProps) {
  return (
    <label className="flex items-center justify-between gap-4 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <span className="grid gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  )
}

function OptionsPage() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [callbackUrl, setCallbackUrl] = useState("")

  useEffect(() => {
    void getSettings().then(setSettings)
    setCallbackUrl(getExtensionCallbackUrl())
  }, [])

  const updateSettings = (nextSettings: ExtensionSettings) => {
    setSettings(nextSettings)
    void saveSettings(nextSettings)
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Pragya Lekh
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Configure Nepali suggestions for inputs, textareas, and
              contenteditable editors on websites.
            </p>
          </div>
          <Badge className="gap-1 border-primary/25 bg-primary/10 text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            No raw typing upload
          </Badge>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              Writing assistance
            </CardTitle>
            <CardDescription>
              Suggestions are generated locally inside the content script.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SettingRow
              checked={settings.enabled}
              description="Run Pragya Lekh on HTTP and HTTPS websites."
              label="Enable extension"
              onChange={(checked) =>
                updateSettings({ ...settings, enabled: checked })
              }
            />
            <SettingRow
              checked={settings.autoMarkEditableFields}
              description="Add a private data attribute to the focused editable field for debugging and styling hooks."
              disabled={!settings.enabled}
              label="Mark editable fields"
              onChange={(checked) =>
                updateSettings({
                  ...settings,
                  autoMarkEditableFields: checked
                })
              }
            />
            <SettingRow
              checked={settings.showNextWordSuggestions}
              description="Show likely next Nepali words near the cursor."
              disabled={!settings.enabled}
              label="Next-word suggestions"
              onChange={(checked) =>
                updateSettings({
                  ...settings,
                  showNextWordSuggestions: checked
                })
              }
            />
            <SettingRow
              checked={settings.showCorrectionSuggestions}
              description="Show Nepali spelling correction suggestions for the current word."
              disabled={!settings.enabled}
              label="Correction suggestions"
              onChange={(checked) =>
                updateSettings({
                  ...settings,
                  showCorrectionSuggestions: checked
                })
              }
            />
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Globe2 className="h-4 w-4 text-primary" />
                Website coverage
              </CardTitle>
              <CardDescription>
                The content script matches all HTTP and HTTPS pages.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <SpellCheck2 className="h-4 w-4 text-primary" />
                Local corrections
              </CardTitle>
              <CardDescription>
                Suggestions use bundled rules and dictionaries only.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Extension callback URL
            </CardTitle>
            <CardDescription>
              Configure the TanStack app to redirect successful login requests
              to this URL with a JWT token query parameter. The extension
              verifies that token with the configured auth me endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {callbackUrl}?token=JWT
            </code>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export default OptionsPage
