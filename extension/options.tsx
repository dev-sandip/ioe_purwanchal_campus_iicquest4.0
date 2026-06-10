import { useEffect, useState } from "react"

import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  type ExtensionSettings
} from "~lib/settings"

const fieldStyle = {
  display: "grid",
  gap: 6,
  padding: "14px 0",
  borderBottom: "1px solid #e5e7eb"
}

function OptionsPage() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void getSettings().then(setSettings)
  }, [])

  const updateSettings = (nextSettings: ExtensionSettings) => {
    setSettings(nextSettings)
    void saveSettings(nextSettings)
  }

  return (
    <main
      style={{
        width: "min(640px, calc(100vw - 32px))",
        margin: "48px auto",
        color: "#111827",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      }}>
      <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Pragya Lekh</h1>
      <p style={{ margin: "0 0 24px", color: "#4b5563" }}>
        Configure extension behavior for editable fields in the browser.
      </p>

      <label style={fieldStyle}>
        <span style={{ fontWeight: 700 }}>Enable extension</span>
        <input
          checked={settings.enabled}
          onChange={(event) =>
            updateSettings({
              ...settings,
              enabled: event.currentTarget.checked
            })
          }
          type="checkbox"
        />
      </label>

      <label style={fieldStyle}>
        <span style={{ fontWeight: 700 }}>Mark editable fields</span>
        <input
          checked={settings.autoMarkEditableFields}
          disabled={!settings.enabled}
          onChange={(event) =>
            updateSettings({
              ...settings,
              autoMarkEditableFields: event.currentTarget.checked
            })
          }
          type="checkbox"
        />
      </label>
    </main>
  )
}

export default OptionsPage
