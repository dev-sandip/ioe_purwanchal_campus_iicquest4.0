import { getSnapshot, getWordContext } from "./editable"
import type { EditableElement, Suggestion } from "./types"

const dispatchTextInputEvent = (element: HTMLElement, value: string) => {
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    })
  )
}

/**
 * Resolve the absolute [start, end] range in the text that a suggestion should
 * replace. When the suggestion carries explicit `replaceStart`/`replaceEnd`
 * offsets (sentence-level corrections), those win so we can replace a word
 * anywhere in the text. Otherwise we fall back to a caret-relative range using
 * `replaceLength` (live predictions / completions at the caret).
 */
const resolveReplaceRange = (
  suggestion: Suggestion,
  caret: number
): { start: number; end: number } => {
  if (
    typeof suggestion.replaceStart === "number" &&
    typeof suggestion.replaceEnd === "number"
  ) {
    return { start: suggestion.replaceStart, end: suggestion.replaceEnd }
  }

  return {
    start: Math.max(0, caret - suggestion.replaceLength),
    end: caret
  }
}

const applySuggestionToTextControl = (
  element: HTMLInputElement | HTMLTextAreaElement,
  suggestion: Suggestion
) => {
  const caret = element.selectionStart ?? element.value.length
  const { start, end } = resolveReplaceRange(suggestion, caret)
  const needsLeadingSpace =
    suggestion.replaceLength === 0 &&
    start > 0 &&
    !/\s$/.test(element.value.slice(0, start))
  const value = `${needsLeadingSpace ? " " : ""}${suggestion.value}`
  const nextValue = `${element.value.slice(0, start)}${value}${element.value.slice(end)}`
  const valueSetter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    "value"
  )?.set

  valueSetter?.call(element, nextValue)

  const caretAfter = start + value.length
  element.setSelectionRange(caretAfter, caretAfter)
  dispatchTextInputEvent(element, value)
}

/**
 * Move a range boundary to an absolute character offset within a
 * contentEditable element, walking its text nodes to locate the position.
 */
const setContentEditableBoundary = (
  element: HTMLElement,
  range: Range,
  offset: number,
  boundary: "start" | "end"
) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let node = walker.nextNode()

  while (node) {
    const textLength = node.textContent?.length ?? 0
    const nextConsumed = consumed + textLength

    if (offset <= nextConsumed) {
      const localOffset = Math.max(0, offset - consumed)

      if (boundary === "start") {
        range.setStart(node, localOffset)
      } else {
        range.setEnd(node, localOffset)
      }

      return
    }

    consumed = nextConsumed
    node = walker.nextNode()
  }

  if (boundary === "start") {
    range.setStart(element, element.childNodes.length)
  } else {
    range.setEnd(element, element.childNodes.length)
  }
}

const applySuggestionToContentEditable = (
  element: HTMLElement,
  suggestion: Suggestion
) => {
  const selection = window.getSelection()

  if (!selection || selection.rangeCount === 0) {
    return
  }

  const range = selection.getRangeAt(0)
  const snapshot = getSnapshot(element)
  const { textBeforeCaret } = getWordContext(snapshot)
  const { start, end } = resolveReplaceRange(suggestion, snapshot.caret)

  if (end > start) {
    setContentEditableBoundary(element, range, start, "start")
    setContentEditableBoundary(element, range, end, "end")
  }

  const needsLeadingSpace =
    suggestion.replaceLength === 0 &&
    textBeforeCaret.length > 0 &&
    !/\s$/.test(textBeforeCaret)
  const text = `${needsLeadingSpace ? " " : ""}${suggestion.value}`

  selection.removeAllRanges()
  selection.addRange(range)

  if (document.execCommand("insertText", false, text)) {
    return
  }

  range.deleteContents()

  const textNode = document.createTextNode(text)

  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  dispatchTextInputEvent(element, text)
}

export const applySuggestionToEditable = (
  element: EditableElement,
  suggestion: Suggestion
) => {
  element.focus()

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    applySuggestionToTextControl(element, suggestion)
  } else {
    applySuggestionToContentEditable(element, suggestion)
  }
}
