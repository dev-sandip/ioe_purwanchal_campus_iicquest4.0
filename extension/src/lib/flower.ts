import { getSamples, clearSamples } from "./storage"

const FLOWER_URL = "http://localhost:8080/client-update"
const REQUEST_TIMEOUT = 30000 // 30 seconds

export async function sendToFlowerServer() {
  const samples = await getSamples()
  
  if (!samples.length) {
    return {
      success: false,
      message: "No local data available."
    }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    const response = await fetch(FLOWER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: getClientId(),
        samples
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(
        `Server error: ${response.status} ${response.statusText}`
      )
    }

    await clearSamples()
    
    return {
      success: true,
      message: "Local data sent successfully."
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          message: `Request timeout after ${REQUEST_TIMEOUT}ms`
        }
      }
      return {
        success: false,
        message: `Failed to send: ${error.message}`
      }
    }
    return {
      success: false,
      message: "Unknown error occurred"
    }
  }
}

function getClientId(): string {
  try {
    let id = localStorage.getItem("pragya_client_id")
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem("pragya_client_id", id)
    }
    return id
  } catch (error) {
    // Fallback for private browsing or quota exceeded
    console.warn("localStorage unavailable, using session ID", error)
    return crypto.randomUUID()
  }
}