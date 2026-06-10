import type { PlasmoCSConfig } from "plasmo"

import { startContentScript } from "~features/content-script/controller"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true
}

startContentScript()
