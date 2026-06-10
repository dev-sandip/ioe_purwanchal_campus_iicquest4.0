import type { PlasmoCSConfig } from "plasmo"

import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings
} from "~lib/settings"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true
}

const ACTIVE_ATTRIBUTE = "data-pragya-lekh-active"

let settings = DEFAULT_SETTINGS

const isEditableElement = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      ["email", "search", "text", "url"].includes(target.type)))

const markEditableElement = (element: HTMLElement, isActive: boolean) => {
  element.toggleAttribute(
    ACTIVE_ATTRIBUTE,
    settings.enabled && settings.autoMarkEditableFields && isActive
  )
}

const loadSettings = async () => {
  const result = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY)

  settings = {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_STORAGE_KEY] as Partial<ExtensionSettings> | undefined)
  }
}

void loadSettings()

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[SETTINGS_STORAGE_KEY]) {
    return
  }

  settings = {
    ...DEFAULT_SETTINGS,
    ...(changes[SETTINGS_STORAGE_KEY].newValue as
      | Partial<ExtensionSettings>
      | undefined)
  }
})

document.addEventListener("focusin", (event) => {
  if (isEditableElement(event.target)) {
    markEditableElement(event.target, true)
  }
})

document.addEventListener("focusout", (event) => {
  if (isEditableElement(event.target)) {
    markEditableElement(event.target, false)
  }
})
