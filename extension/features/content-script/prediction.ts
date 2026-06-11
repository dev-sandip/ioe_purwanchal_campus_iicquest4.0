import type { ExtensionSettings } from "~lib/settings"

import {
  DEVANAGARI_PATTERN,
  LATIN_PATTERN,
  MIN_CONTEXT_WORDS
} from "./constants"
import {
  COMMON_WORDS,
  CORRECTIONS,
  ENGLISH_COMMON_WORDS,
  ENGLISH_NEXT_WORDS,
  NEXT_WORDS
} from "./dictionaries"
import type { PredictionContext, Suggestion } from "./types"

const getCorrectionSuggestions = (
  currentWord: string,
  settings: ExtensionSettings
): Suggestion[] => {
  if (
    !settings.showCorrectionSuggestions ||
    !DEVANAGARI_PATTERN.test(currentWord)
  ) {
    return []
  }

  return (CORRECTIONS[currentWord] ?? []).map((value) => ({
    kind: "correction",
    label: "Correction",
    replaceLength: currentWord.length,
    value
  }))
}

const getNepaliNextWordSuggestions = (
  { currentWord, previousWord, textBeforeCaret }: PredictionContext,
  settings: ExtensionSettings
): Suggestion[] => {
  if (!settings.showNextWordSuggestions) {
    return []
  }

  const isBetweenWords = /\s$/.test(textBeforeCaret) || currentWord.length === 0

  if (isBetweenWords) {
    return (NEXT_WORDS[previousWord] ?? NEXT_WORDS[""]).map((value) => ({
      kind: "next",
      label: "Next word",
      replaceLength: 0,
      value
    }))
  }

  if (!DEVANAGARI_PATTERN.test(currentWord)) {
    return []
  }

  return COMMON_WORDS.filter(
    (word) => word !== currentWord && word.startsWith(currentWord)
  )
    .slice(0, 3)
    .map((value) => ({
      kind: "next",
      label: "Complete",
      replaceLength: currentWord.length,
      value
    }))
}

const getEnglishSuggestions = (
  { currentWord, previousWord, textBeforeCaret }: PredictionContext,
  settings: ExtensionSettings
): Suggestion[] => {
  if (!settings.showNextWordSuggestions) {
    return []
  }

  const normalizedCurrentWord = currentWord.toLowerCase()
  const normalizedPreviousWord = previousWord.toLowerCase()
  const isBetweenWords = /\s$/.test(textBeforeCaret) || currentWord.length === 0

  if (isBetweenWords) {
    return (
      ENGLISH_NEXT_WORDS[normalizedPreviousWord] ?? ENGLISH_NEXT_WORDS[""]
    ).map((value) => ({
      kind: "next",
      label: "Next word",
      replaceLength: 0,
      value
    }))
  }

  if (!LATIN_PATTERN.test(currentWord)) {
    return []
  }

  return ENGLISH_COMMON_WORDS.filter(
    (word) =>
      word !== normalizedCurrentWord && word.startsWith(normalizedCurrentWord)
  )
    .slice(0, 3)
    .map((value) => ({
      kind: "next",
      label: "Complete",
      replaceLength: currentWord.length,
      value
    }))
}

export const predictLocally = (
  context: PredictionContext,
  settings: ExtensionSettings
): Suggestion[] => {
  const unique = new Map<string, Suggestion>()
  const hasUsableContext =
    context.contextWords.length >= MIN_CONTEXT_WORDS ||
    context.currentWord.length > 0 ||
    /\s$/.test(context.textBeforeCaret)

  if (!hasUsableContext) {
    return []
  }

  const suggestions =
    context.language === "english"
      ? getEnglishSuggestions(context, settings)
      : [
          ...getCorrectionSuggestions(context.currentWord, settings),
          ...getNepaliNextWordSuggestions(context, settings)
        ]

  for (const suggestion of suggestions) {
    unique.set(`${suggestion.kind}:${suggestion.value}`, suggestion)
  }

  return Array.from(unique.values()).slice(0, 5)
}
