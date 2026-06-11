import { trackCorrection, trackError, trackPrediction } from "~/lib/stats"
import { saveDetection, saveSample } from "~/lib/storage"
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings
} from "~lib/settings"

import { checkSentenceCorrection } from "./correction"
import { debounce } from "./debouncer"
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
import { predictCurrentWord } from "./prediction-api"
import type { EditableElement, Suggestion } from "./types"

const ENABLE_PREDICTION = true
const ENABLE_CORRECTION = true

let settings = DEFAULT_SETTINGS
let activeEditable: EditableElement | null = null
let activeSuggestions: Suggestion[] = []
let suggestionRequestId = 0

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

  if (suggestion.type === "correction") {
    trackCorrection()
  } else {
    trackPrediction()
  }

  void saveSuggestionSample(suggestion)
  void updateAllSuggestions()
}

const acceptActiveSuggestion = () => {
  const [suggestion] = activeSuggestions

  if (!suggestion) return false

  applySuggestion(suggestion)
  return true
}

/**
 * Single coordinated pass that produces both live word-level predictions for
 * the word currently being typed and sentence-level corrections for the rest
 * of the text. Results are merged (predictions first, since they target the
 * caret), deduped, and rendered once.
 */
const updateSuggestions = async () => {
  if (!settings.enabled || !activeEditable) {
    hideSuggestions()
    return
  }

  const editable = activeEditable
  const snapshot = getSnapshot(editable)
  const context = getWordContext(snapshot)
  const text = snapshot.text.trim()

  if (!text || context.language !== "nepali") {
    hideSuggestions()
    return
  }

  const requestId = ++suggestionRequestId
  const merged: Suggestion[] = []
  const seenValues = new Set<string>()

  const pushSuggestion = (suggestion: Suggestion) => {
    if (seenValues.has(suggestion.value)) return
    seenValues.add(suggestion.value)
    merged.push(suggestion)
  }

  const caret = snapshot.caret
  const currentWord = context.currentWord
  const currentWordStart = caret - currentWord.length
  const predictingCurrentWord =
    ENABLE_PREDICTION &&
    settings.showNextWordSuggestions &&
    currentWord.length > 0 &&
    !/\s$/.test(context.textBeforeCaret)

  // 1. Live prediction for the word currently being typed.
  if (predictingCurrentWord) {
    try {
      const predictions = await predictCurrentWord(context, {
        maxSuggestions: 3
      })

      if (requestId !== suggestionRequestId) return

      predictions.forEach(pushSuggestion)
    } catch (error) {
      console.error("[Pragya] Prediction failed:", error)
    }
  }

  // 2. Sentence-level corrections for every flagged word.
  if (ENABLE_CORRECTION && settings.showCorrectionSuggestions) {
    try {
      const result = await checkSentenceCorrection(text)

      if (requestId !== suggestionRequestId) return

      for (const word of result.words) {
        if (!word.correct) {
          trackError()
          void saveDetection({
            word: word.word,
            suggestions: word.suggestions,
            sentence: text
          })
        }

        if (word.correct || word.suggestions.length === 0) {
          continue
        }

        // The in-progress word is already handled by live prediction above.
        const isCurrentWord =
          predictingCurrentWord &&
          word.start === currentWordStart &&
          word.end === caret

        if (isCurrentWord) {
          continue
        }

        pushSuggestion({
          value: word.suggestions[0],
          label: `${word.word} → ${word.suggestions[0]}`,
          kind: "correction",
          type: "correction",
          replaceLength: word.word.length,
          replaceStart: word.start,
          replaceEnd: word.end
        })
      }
    } catch (error) {
      console.error("[Pragya] Correction check failed:", error)
    }
  }

  if (requestId !== suggestionRequestId) return

  if (merged.length === 0) {
    hideSuggestions()
    return
  }

  activeSuggestions = merged.slice(0, 6)

  renderSuggestions(editable, activeSuggestions, {
    onSelect: applySuggestion
  })
}

const debouncedUpdateSuggestions = debounce(() => {
  void updateSuggestions()
}, 500)

function updateAllSuggestions() {
  if (!settings.enabled || !activeEditable) {
    hideSuggestions()
    return
  }

  debouncedUpdateSuggestions()
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
