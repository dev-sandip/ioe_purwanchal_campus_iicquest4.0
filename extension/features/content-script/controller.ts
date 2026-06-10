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
import { checkSentenceCorrection } from "./correction"
import { debounce } from "./debouncer"
import { saveSample } from "~/lib/storage"
import { predictText } from "~/lib/onnx"

const ENABLE_PREDICTION = false
const ENABLE_CORRECTION = true

let settings = DEFAULT_SETTINGS
let activeEditable: EditableElement | null = null
let activeSuggestions: Suggestion[] = []
let correctionRequestId = 0

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

const saveSuggestionSample = async (suggestion: Suggestion) => {
  if (!activeEditable) {
    return
  }

  const snapshot = getSnapshot(activeEditable)
  const context = getWordContext(snapshot)

  await saveSample({
    contextWords: context.contextWords,
    currentWord: context.currentWord,
    previousWord: context.previousWord,
    textBeforeCaret: context.textBeforeCaret,
    language: context.language,
    suggestion: suggestion.value,
    suggestionKind: suggestion.kind,
    replaceLength: suggestion.replaceLength
  })
}

const saveSuggestionSample = async (suggestion: Suggestion) => {
  if (!activeEditable) {
    return
  }

  const snapshot = getSnapshot(activeEditable)
  const context = getWordContext(snapshot)

  await saveSample({
    contextWords: context.contextWords,
    currentWord: context.currentWord,
    previousWord: context.previousWord,
    textBeforeCaret: context.textBeforeCaret,
    language: context.language,
    suggestion: suggestion.value,
    suggestionKind: suggestion.kind,
    replaceLength: suggestion.replaceLength
  })
}

const applySuggestion = (suggestion: Suggestion) => {
  if (!activeEditable) return

  applySuggestionToEditable(activeEditable, suggestion)
  void saveSuggestionSample(suggestion)
  void updateAllSuggestions()
}

const acceptActiveSuggestion = () => {
  const [suggestion] = activeSuggestions

  if (!suggestion) return false

  applySuggestion(suggestion)
  return true
}

const decodeModelPrediction = (output: number[]) => {
  if (output.length === 0) {
    return ""
  }

  const isSafeAscii = (value: number) =>
    Number.isInteger(value) && value >= 32 && value <= 126

  if (!output.every(isSafeAscii)) {
    return ""
  }

  return String.fromCharCode(...output).trim()
}

const runPredictionSuggestions = async () => {
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
  ).map((suggestion) => ({
    ...suggestion,
    type: "prediction" as const
  }))

  try {
    const prediction = await predictText(context.textBeforeCaret)
    const modelValue = decodeModelPrediction(prediction)

    if (modelValue && modelValue !== context.currentWord) {
      suggestions.unshift({
        kind: "next",
        label: "Model suggestion",
        replaceLength: context.currentWord.length,
        value: modelValue
      })
    }
  } catch {
    // Ignore ONNX model failures and continue with dictionary suggestions.
  }

  if (suggestions.length === 0) {
    hideSuggestions()
    return
  }

  const uniqueSuggestions = new Map<string, Suggestion>()

  for (const suggestion of suggestions) {
    uniqueSuggestions.set(`${suggestion.kind}:${suggestion.value}`, suggestion)
  }

  const dedupedSuggestions = Array.from(uniqueSuggestions.values()).slice(0, 5)

  if (dedupedSuggestions.length === 0) {
    hideSuggestions()
    return
  }

  activeSuggestions = dedupedSuggestions
  renderSuggestions(activeEditable, dedupedSuggestions, {
    onSelect: applySuggestion
  })
}

const updateCorrectionSuggestions = async () => {
  if (!settings.enabled || !activeEditable) return

  const requestId = ++correctionRequestId
  const snapshot = getSnapshot(activeEditable)
  const text = snapshot.text.trim()

  if (!text) return

  try {
    const result = await checkSentenceCorrection(text)

    if (requestId !== correctionRequestId) return

    const correctionSuggestions: Suggestion[] = result.words
      .filter((word) => !word.correct && word.suggestions.length > 0)
      .map((word) => ({
        value: word.suggestions[0],
        label: `${word.word} → ${word.suggestions[0]}`,
        type: "correction",
        replaceStart: word.start,
        replaceEnd: word.end
      }))

    if (correctionSuggestions.length === 0) return

    activeSuggestions = correctionSuggestions

    renderSuggestions(activeEditable, correctionSuggestions, {
      onSelect: applySuggestion
    })
  } catch (error) {
    console.error("Correction check failed:", error)
  }
}

const debouncedCorrectionCheck = debounce(() => {
  void updateCorrectionSuggestions()
}, 600)

function runCorrectionSuggestions() {
  debouncedCorrectionCheck()
}

function updateAllSuggestions() {
  if (!settings.enabled || !activeEditable) {
    hideSuggestions()
    return
  }

  if (ENABLE_PREDICTION) {
    runPredictionSuggestions()
  }

  if (ENABLE_CORRECTION) {
    runCorrectionSuggestions()
  }
}

const handleEditableFocus = (event: Event, isActive: boolean) => {
  const editable = getEditableFromEvent(event)

  if (!editable) return

  markEditableElement(
    editable,
    isActive,
    settings.enabled && settings.autoMarkEditableFields
  )

  if (isActive) {
    activeEditable = editable
    void updateAllSuggestions()
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

  if (!editable) return

  activeEditable = editable
  void updateAllSuggestions()
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
    if (areaName !== "sync" || !changes[SETTINGS_STORAGE_KEY]) return

    settings = {
      ...DEFAULT_SETTINGS,
      ...(changes[SETTINGS_STORAGE_KEY].newValue as
        | Partial<ExtensionSettings>
        | undefined)
    }

    updateAllSuggestions()
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
      updateAllSuggestions()
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