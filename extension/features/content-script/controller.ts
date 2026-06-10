import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings
} from "~lib/settings"

import {
  getEditableFromEvent,
  getSnapshot,
  getWordContext,
  markEditableElement
} from "./editable"
import { applySuggestionToEditable } from "./insertion"
import {
  getPopover,
  hidePopover,
  positionPopover,
  renderSuggestions
} from "./popover"
import { predictLocally } from "./prediction"
import type { EditableElement, Suggestion } from "./types"

let settings = DEFAULT_SETTINGS
let activeEditable: EditableElement | null = null
let activeSuggestions: Suggestion[] = []

const hideSuggestions = () => {
  activeSuggestions = []
  hidePopover()
}

const loadSettings = async () => {
  const result = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY)

  settings = {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_STORAGE_KEY] as Partial<ExtensionSettings> | undefined)
  }
}

const applySuggestion = (suggestion: Suggestion) => {
  if (!activeEditable) {
    return
  }

  applySuggestionToEditable(activeEditable, suggestion)
  updateSuggestions()
}

const acceptActiveSuggestion = () => {
  const [suggestion] = activeSuggestions

  if (!suggestion) {
    return false
  }

  applySuggestion(suggestion)
  return true
}

function updateSuggestions() {
  if (!settings.enabled || !activeEditable) {
    hideSuggestions()
    return
  }

  const snapshot = getSnapshot(activeEditable)
  const context = getWordContext(snapshot)
  const suggestions = predictLocally(
    {
      contextWords: context.contextWords,
      currentWord: context.currentWord,
      language: context.language,
      previousWord: context.previousWord,
      textBeforeCaret: context.textBeforeCaret
    },
    settings
  )

  if (suggestions.length === 0) {
    hideSuggestions()
    return
  }

  activeSuggestions = suggestions
  renderSuggestions(activeEditable, suggestions, {
    onSelect: applySuggestion
  })
}

const handleEditableFocus = (event: Event, isActive: boolean) => {
  const editable = getEditableFromEvent(event)

  if (!editable) {
    return
  }

  markEditableElement(
    editable,
    isActive,
    settings.enabled && settings.autoMarkEditableFields
  )

  if (isActive) {
    activeEditable = editable
    updateSuggestions()
    return
  }

  setTimeout(() => {
    if (document.activeElement !== getPopover()) {
      activeEditable = null
      hideSuggestions()
    }
  }, 0)
}

const handleEditableInput = (event: Event) => {
  const editable = getEditableFromEvent(event)

  if (!editable) {
    return
  }

  activeEditable = editable
  updateSuggestions()
}

const handleSuggestionAcceptKey = (event: KeyboardEvent) => {
  const editable = getEditableFromEvent(event)

  if (editable) {
    activeEditable = editable
  }

  if (
    activeEditable &&
    activeSuggestions.length > 0 &&
    (event.key === "Tab" || event.key === "ArrowRight") &&
    acceptActiveSuggestion()
  ) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

export const startContentScript = () => {
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

    updateSuggestions()
  })

  document.addEventListener("focusin", (event) => {
    handleEditableFocus(event, true)
  })

  document.addEventListener("focusout", (event) => {
    handleEditableFocus(event, false)
  })

  document.addEventListener("input", handleEditableInput)
  document.addEventListener("keyup", handleEditableInput)
  window.addEventListener("keydown", handleSuggestionAcceptKey, true)
  document.addEventListener("keydown", handleSuggestionAcceptKey, true)

  document.addEventListener("selectionchange", () => {
    if (activeEditable && document.activeElement === activeEditable) {
      updateSuggestions()
    }
  })

  window.addEventListener(
    "scroll",
    () => {
      if (activeEditable && activeSuggestions.length > 0) {
        positionPopover(activeEditable)
      }
    },
    true
  )

  window.addEventListener("resize", () => {
    if (activeEditable && activeSuggestions.length > 0) {
      positionPopover(activeEditable)
    }
  })
}
