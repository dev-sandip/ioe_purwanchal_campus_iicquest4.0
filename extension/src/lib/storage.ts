import { openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"

interface Sample {
  id?: number
  createdAt: number
  [key: string]: unknown
}

interface PragyaDB extends DBSchema {
  samples: {
    key: number
    value: Sample
  }
}

const dbPromise: Promise<IDBPDatabase<PragyaDB>> = openDB<PragyaDB>("pragya-db", 1, {
  upgrade(db) {
    db.createObjectStore("samples", {
      keyPath: "id",
      autoIncrement: true
    })
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