import {
  ACTIVE_ATTRIBUTE,
  MAX_CONTEXT_WORDS,
  WORD_PATTERN,
  WORDS_PATTERN
} from "./constants"
import type {
  DetectedLanguage,
  EditableElement,
  TextSnapshot,
  WordContext
} from "./types"

export const isTextInput = (
  element: HTMLElement
): element is HTMLInputElement =>
  element instanceof HTMLInputElement &&
  !element.readOnly &&
  !element.disabled &&
  ["search", "tel", "text", "url", ""].includes(element.type)

export const isEditableElement = (
  target: EventTarget | null
): target is EditableElement =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    isTextInput(target))

export const getEditableFromEvent = (event: Event): EditableElement | null => {
  for (const target of event.composedPath()) {
    if (isEditableElement(target)) {
      return target
    }
  }

  return null
}

export const markEditableElement = (
  element: HTMLElement,
  isActive: boolean,
  shouldMark: boolean
) => {
  element.toggleAttribute(ACTIVE_ATTRIBUTE, shouldMark && isActive)
}

export const getSnapshot = (element: EditableElement): TextSnapshot => {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return {
      caret: element.selectionStart ?? element.value.length,
      text: element.value
    }
  }

  const selection = window.getSelection()

  if (!selection || selection.rangeCount === 0) {
    const text = element.textContent ?? ""
console.log("[Content Script] No selection found, defaulting caret to end of text. Text length:", text.length)
console.log("[Content Script] Element text content:", text)
    return {
      caret: text.length,
      text
    }
  }

  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()

  preCaretRange.selectNodeContents(element)
  preCaretRange.setEnd(range.endContainer, range.endOffset)

  return {
    caret: preCaretRange.toString().length,
    text: element.textContent ?? ""
  }
}

export const extractContextWords = (textBeforeCaret: string): string[] =>
  Array.from(textBeforeCaret.matchAll(WORDS_PATTERN), ([word]) => word).slice(
    -MAX_CONTEXT_WORDS
  )

export const detectLanguage = (text: string): DetectedLanguage => {
  const nepaliCharacters = text.match(/[\u0900-\u097F]/g)?.length ?? 0
  const englishCharacters = text.match(/[A-Za-z]/g)?.length ?? 0

  if (nepaliCharacters === 0 && englishCharacters === 0) {
    return "unknown"
  }

  return nepaliCharacters >= englishCharacters ? "nepali" : "english"
}

export const getWordContext = ({ caret, text }: TextSnapshot): WordContext => {
  const textBeforeCaret = text.slice(0, caret)
  const currentWord = textBeforeCaret.match(WORD_PATTERN)?.[0] ?? ""
  const beforeCurrentWord = textBeforeCaret.slice(
    0,
    textBeforeCaret.length - currentWord.length
  )
  const previousWord = beforeCurrentWord.match(WORD_PATTERN)?.[0] ?? ""
  const contextWords = extractContextWords(textBeforeCaret)

  return {
    contextWords,
    currentWord,
    language: detectLanguage(contextWords.join(" ") || currentWord),
    previousWord,
    textBeforeCaret
  }
}
