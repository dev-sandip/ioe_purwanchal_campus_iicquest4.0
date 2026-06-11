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
import { saveSample, saveDetection } from "~/lib/storage"
import { predictText } from "~/lib/onnx"

const ENABLE_PREDICTION = true
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
  console.log("[ONNX] runPredictionSuggestions called, enabled:", settings.enabled)
  if (!settings.enabled || !activeEditable) {
    hideSuggestions()
    return
  }

  const snapshot = getSnapshot(activeEditable)
  const context = getWordContext(snapshot)

  // Only run on Nepali text
  console.log("[ONNX] Language detected:", context.language, "Text:", context.textBeforeCaret)
  if (context.language !== "nepali") {
    return
  }

  const text = context.textBeforeCaret.trim()
  if (!text) return

  try {
    console.log("[ONNX] Input text:", text)
    const prediction = await predictText(text)
    console.log("[ONNX] Model output:", prediction)

    // Model returns 0 (correct) or 1 (error) per word
    const words = text.split(/\s+/)
    for (let i = 0; i < words.length && i < prediction.length; i++) {
      const label = Math.round(prediction[i])
      if (label === 1) {
        console.log("[ONNX] Error detected in word:", words[i])
      } else {
        console.log("[ONNX] Word correct:", words[i])
      }
    }
  } catch (error) {
    console.error("[ONNX] Prediction failed:", error)
  }
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
        kind: "correction" as const,
        type: "correction" as const,
        replaceLength: word.word.length,
        replaceStart: word.start,
        replaceEnd: word.end
      }))

    // Save detected spelling errors to IndexedDB
    for (const word of result.words.filter((w) => !w.correct)) {
      void saveDetection({
        word: word.word,
        suggestions: word.suggestions,
        sentence: text
      })
    }

    if (correctionSuggestions.length === 0) return

    activeSuggestions = correctionSuggestions

    renderSuggestions(activeEditable, correctionSuggestions, {
      onSelect: applySuggestion
    })
  } catch (error) {
    console.error("Correction check failed:", error)
  }
}

const debouncedPredictionCheck = debounce(() => {
  void runPredictionSuggestions()
}, 400)

const debouncedCorrectionCheck = debounce(() => {
  void updateCorrectionSuggestions()
}, 600)

function runCorrectionSuggestions() {
  debouncedCorrectionCheck()
}

function updateAllSuggestions() {
  console.log("[Pragya] updateAllSuggestions called, enabled:", settings.enabled, "editable:", !!activeEditable)
  if (!settings.enabled || !activeEditable) {
    hideSuggestions()
    return
  }

  if (ENABLE_PREDICTION) {
    debouncedPredictionCheck()
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