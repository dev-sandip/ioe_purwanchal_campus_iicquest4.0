import { getSnapshot } from "./editable"
import type { EditableElement } from "./types"

const getInputCaretRect = (
  element: HTMLInputElement | HTMLTextAreaElement
): DOMRect => {
  const snapshot = getSnapshot(element)
  const computed = window.getComputedStyle(element)
  const mirror = document.createElement("div")
  const marker = document.createElement("span")

  mirror.style.cssText = [
    "position: fixed",
    "visibility: hidden",
    "white-space: pre-wrap",
    "word-wrap: break-word",
    `top: ${element.getBoundingClientRect().top}px`,
    `left: ${element.getBoundingClientRect().left}px`,
    `width: ${element.getBoundingClientRect().width}px`,
    `height: ${element.getBoundingClientRect().height}px`,
    `padding: ${computed.padding}`,
    `border: ${computed.border}`,
    `font: ${computed.font}`,
    `letter-spacing: ${computed.letterSpacing}`,
    `line-height: ${computed.lineHeight}`,
    `box-sizing: ${computed.boxSizing}`,
    "overflow: hidden"
  ].join(";")

  mirror.textContent = snapshot.text.slice(0, snapshot.caret)
  marker.textContent = "\u200b"
  mirror.append(marker)
  document.documentElement.append(mirror)

  const rect = marker.getBoundingClientRect()
  mirror.remove()

  return rect
}

export const getCaretRect = (element: EditableElement): DOMRect => {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return getInputCaretRect(element)
  }

  const selection = window.getSelection()

  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0).cloneRange()
    range.collapse(false)

    const rect = range.getBoundingClientRect()

    if (rect.width || rect.height) {
      return rect
    }
  }

  return element.getBoundingClientRect()
}
