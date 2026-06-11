import { openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"

interface Sample {
  id?: number
  createdAt: number
  [key: string]: unknown
}

export interface Detection {
  id?: number
  createdAt: number
  word: string
  suggestions: string[]
  sentence: string
}

interface PragyaDB extends DBSchema {
  samples: {
    key: number
    value: Sample
  }
  detections: {
    key: number
    value: Detection
  }
}

const dbPromise: Promise<IDBPDatabase<PragyaDB>> = openDB<PragyaDB>("pragya-db", 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("samples")) {
      db.createObjectStore("samples", {
        keyPath: "id",
        autoIncrement: true
      })
    }
    if (!db.objectStoreNames.contains("detections")) {
      db.createObjectStore("detections", {
        keyPath: "id",
        autoIncrement: true
      })
    }
  }
})

export async function saveSample(sample: Omit<Sample, "id" | "createdAt">): Promise<void> {
  const db = await dbPromise
  await db.add("samples", {
    ...sample,
    createdAt: Date.now()
  })
}

export async function getSamples(): Promise<Sample[]> {
  const db = await dbPromise
  return db.getAll("samples")
}

export async function clearSamples(): Promise<void> {
  const db = await dbPromise
  await db.clear("samples")
}

export async function saveDetection(
  detection: Omit<Detection, "id" | "createdAt">
): Promise<void> {
  const db = await dbPromise
  await db.add("detections", {
    ...detection,
    createdAt: Date.now()
  })
}

export async function getDetections(): Promise<Detection[]> {
  const db = await dbPromise
  return db.getAll("detections")
}