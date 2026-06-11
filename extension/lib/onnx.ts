// ONNX Runtime runs inside a dedicated worker (see assets/ort-worker.js).
// The worker is a raw asset loaded from the extension origin, which keeps ORT
// and its WASM backend out of the Parcel bundle (Parcel breaks ORT's dynamic
// backend import) and out of the host page's CSP.

let worker: Worker | null = null
let initPromise: Promise<void> | null = null
let messageId = 0

type PendingEntry = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

const pending = new Map<number, PendingEntry>()

function rejectAllPending(reason: unknown): void {
  for (const entry of pending.values()) {
    entry.reject(reason)
  }
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(chrome.runtime.getURL("assets/ort-worker.js"), {
    type: "module"
  })

  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, data, error } = event.data ?? {}
    const entry = pending.get(id)

    if (!entry) return

    pending.delete(id)

    if (ok) {
      entry.resolve(data)
    } else {
      entry.reject(new Error(error ?? "ONNX worker error"))
    }
  }

  worker.onerror = (event) => {
    // Reset so a later call can recreate the worker.
    worker = null
    initPromise = null
    rejectAllPending(new Error(event.message || "ONNX worker crashed"))
  }

  return worker
}

function callWorker<T>(type: string, payload: unknown): Promise<T> {
  const activeWorker = getWorker()
  const id = ++messageId

  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject
    })
    activeWorker.postMessage({ id, type, payload })
  })
}

const DB_NAME = "pragya-lekh-db"
const DB_VERSION = 1
const STORE_NAME = "models"
const MODEL_KEY = "detector_best"
const MODEL_PATH = "assets/model/detector_best.onnx"

function openModelDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"))
    }
  })
}

async function saveModelToIndexedDB(buffer: ArrayBuffer): Promise<void> {
  const db = await openModelDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)

    const request = store.put(buffer, MODEL_KEY)

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to save model"))
    }

    tx.oncomplete = () => {
      db.close()
      resolve()
    }

    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error("IndexedDB transaction failed"))
    }
  })
}

async function getModelFromIndexedDB(): Promise<ArrayBuffer | null> {
  const db = await openModelDB()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)

    const request = store.get(MODEL_KEY)

    request.onsuccess = () => {
      db.close()
      resolve((request.result as ArrayBuffer | undefined) ?? null)
    }

    request.onerror = () => {
      db.close()
      reject(request.error ?? new Error("Failed to read model"))
    }
  })
}

async function loadModelBuffer(): Promise<ArrayBuffer> {
  const cachedModel = await getModelFromIndexedDB()
console.log("[ONNX] Checked IndexedDB for ONNX model, found:", !!cachedModel)
  if (cachedModel) {
    console.log("[ONNX] Loaded ONNX model from IndexedDB")
    return cachedModel
  }

  const modelUrl = chrome.runtime.getURL(MODEL_PATH)
  const response = await fetch(modelUrl)

  if (!response.ok) {
    throw new Error(`Failed to fetch ONNX model: ${response.status}`)
  }

  const buffer = await response.arrayBuffer()

  await saveModelToIndexedDB(buffer)

  console.log("Saved ONNX model to IndexedDB")

  return buffer
}

async function ensureSession(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    const modelBuffer = await loadModelBuffer()

    await callWorker("init", {
      modelBuffer,
      wasmPaths: chrome.runtime.getURL("assets/")
    })
  })().catch((error) => {
    // Allow re-initialization after a failure.
    initPromise = null
    throw error
  })

  return initPromise
}

export function tokenize(text: string): number[] {
  return text
    .split("")
    .map((char) => char.charCodeAt(0))
    .slice(0, 128)
}

export async function predictText(text: string): Promise<number[]> {
  await ensureSession()

  const tokens = tokenize(text)
  const output = await callWorker<number[]>("predict", { tokens })

  console.log("[ONNX] Model run completed, raw output:", output)
  return output
}