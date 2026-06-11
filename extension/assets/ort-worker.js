// ONNX Runtime worker.
//
// This file is intentionally a raw asset that is copied verbatim by Plasmo and
// is NOT processed by the Parcel bundler. That matters: when ORT is imported
// through the bundler, Parcel rewrites ORT's internal dynamic import of its
// WASM backend glue into its own module loader, which then fails at runtime
// with "no available backend found / Cannot find module ...".
//
// Because this worker is loaded from a chrome-extension:// URL, the `import`
// below is a native ES module import resolved against the extension origin, so
// ORT loads its backend correctly. Running in a worker spawned from the
// extension origin also keeps WASM execution out of the host page's CSP.
import * as ort from "./ort.wasm.bundle.min.mjs"

let session = null

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {}

  try {
    if (type === "init") {
      ort.env.wasm.wasmPaths = payload.wasmPaths
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false

      session = await ort.InferenceSession.create(
        new Uint8Array(payload.modelBuffer),
        { executionProviders: ["wasm"] }
      )

      self.postMessage({ id, ok: true })
      return
    }

    if (type === "predict") {
      if (!session) {
        throw new Error("ONNX session is not initialized")
      }

      const tokens = payload.tokens
      const inputTensor = new ort.Tensor(
        "int64",
        BigInt64Array.from(tokens.map((value) => BigInt(value))),
        [1, tokens.length]
      )

      const result = await session.run({
        [session.inputNames[0]]: inputTensor
      })
      const output = result[session.outputNames[0]]

      self.postMessage({ id, ok: true, data: Array.from(output.data) })
      return
    }

    throw new Error("Unknown ONNX worker message type: " + type)
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: String((error && error.message) || error)
    })
  }
}
