import type { PlasmoCSConfig } from "plasmo"

import { startContentScript } from "~features/content-script/controller"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true
}

const STARTED_KEY = "__pragya_lekh_content_script_started__"

if (!(window as any)[STARTED_KEY]) {
  ;(window as any)[STARTED_KEY] = true
  startContentScript()
}