export type ExtensionSettings = {
  enabled: boolean
  autoMarkEditableFields: boolean
}

export const SETTINGS_STORAGE_KEY = "pragyaLekhSettings"

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  autoMarkEditableFields: true
}

const hasStorage = () =>
  typeof chrome !== "undefined" && Boolean(chrome.storage?.sync)

export const getSettings = async (): Promise<ExtensionSettings> => {
  if (!hasStorage()) {
    return DEFAULT_SETTINGS
  }

  const result = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY)

  return {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_STORAGE_KEY] as Partial<ExtensionSettings> | undefined)
  }
}

export const saveSettings = async (
  settings: ExtensionSettings
): Promise<void> => {
  if (!hasStorage()) {
    return
  }

  await chrome.storage.sync.set({
    [SETTINGS_STORAGE_KEY]: settings
  })
}
