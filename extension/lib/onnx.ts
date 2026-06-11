import * as ort from "onnxruntime-web"

let session: ort.InferenceSession | null = null

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

export async function loadOnnxModel(): Promise<ort.InferenceSession> {
  if (session) return session

  const modelBuffer = await loadModelBuffer()

  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ["wasm"]
  })

  return session
}

export function tokenize(text: string): number[] {
  return text
    .split("")
    .map((char) => char.charCodeAt(0))
    .slice(0, 128)
}

export async function predictText(text: string): Promise<number[]> {
  const model = await loadOnnxModel()
  const tokens = tokenize(text)

  const inputTensor = new ort.Tensor(
    "int64",
    BigInt64Array.from(tokens.map(BigInt)),
    [1, tokens.length]
  )

  const inputName = model.inputNames[0]
  const outputName = model.outputNames[0]

  const result = await model.run({
    [inputName]: inputTensor
  })
console.log("[ONNX] Model run completed, raw output:", result[outputName])
  return Array.from(result[outputName].data as Float32Array)
}