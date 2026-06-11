import { authenticatedFetch } from "./auth"

const BASE_URL = "https://ioe-purwanchal-campus-iicquest4-0.vercel.app"
const STATS_URL = `${BASE_URL}/api/extension/stats`

let pendingStats = { predictions: 0, corrections: 0, errorsDetected: 0 }
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function trackPrediction() {
  pendingStats.predictions++
  scheduleFlush()
}

export function trackCorrection() {
  pendingStats.corrections++
  scheduleFlush()
}

export function trackError() {
  pendingStats.errorsDetected++
  scheduleFlush()
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    void flushStats()
    flushTimer = null
  }, 30_000) // batch every 30s
}

async function flushStats() {
  const data = { ...pendingStats }
  if (!data.predictions && !data.corrections && !data.errorsDetected) return

  pendingStats = { predictions: 0, corrections: 0, errorsDetected: 0 }

  try {
    console.log("[Stats] Sending stats to API:", data)
    await authenticatedFetch(STATS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    })
    console.log("[Stats] Stats sent successfully")
  } catch (error) {
    console.error("[Stats] Failed to send stats:", error)
    // Re-add on failure
    pendingStats.predictions += data.predictions
    pendingStats.corrections += data.corrections
    pendingStats.errorsDetected += data.errorsDetected
  }
}
