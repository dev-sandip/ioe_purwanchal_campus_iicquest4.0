import { useEffect, useState } from "react"

import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  type ExtensionSettings
} from "~lib/settings"

function IndexPopup() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void getSettings().then(setSettings)
  }, [])

  const updateSettings = (nextSettings: ExtensionSettings) => {
    setSettings(nextSettings)
    void saveSettings(nextSettings)
  }

  return (
    <div
      style={{
        width: 320,
        padding: 16,
        color: "#111827",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      }}>
      <h1 style={{ fontSize: 20, margin: "0 0 6px" }}>Pragya Lekh</h1>
      <p style={{ margin: "0 0 16px", color: "#4b5563", lineHeight: 1.45 }}>
        Nepali writing assistance for text fields across the browser.
        Sandip is very handsome boi
      </p>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 0",
          borderTop: "1px solid #e5e7eb"
        }}>
        <span style={{ fontWeight: 700 }}>Enabled</span>
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

      <button
        onClick={() => chrome.runtime.openOptionsPage()}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "10px 12px",
          border: 0,
          borderRadius: 6,
          color: "#ffffff",
          background: "#2563eb",
          fontWeight: 700,
          cursor: "pointer"
        }}
        type="button">
        Open settings
      </button>
    </div>
  )
}

export default IndexPopup
