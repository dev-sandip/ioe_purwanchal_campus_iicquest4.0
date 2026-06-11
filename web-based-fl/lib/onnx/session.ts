// ONNX Runtime Web session loader + cache.
//
// onnxruntime-web ships WebAssembly binaries that must be reachable from the
// browser. The simplest reliable setup in a Next.js app is to point
// `ort.env.wasm.wasmPaths` at the matching version on a CDN. If you prefer to
// self-host, copy `node_modules/onnxruntime-web/dist/*.wasm` (and `.mjs`) into
// `public/ort/` and set wasmPaths to "/ort/".

import * as ort from "onnxruntime-web";

const ORT_VERSION = "1.26.0";
const CDN_WASM_PATH = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

let configured = false;

function configureRuntime() {
  if (configured) return;
  // Use the CDN-hosted wasm binaries matching the installed version.
  ort.env.wasm.wasmPaths = CDN_WASM_PATH;
  // Run fully on the main thread: single-threaded + no proxy worker. This
  // avoids any "Failed to construct 'Worker'" errors and does not require
  // cross-origin isolation (COOP/COEP) headers.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "warning";
  configured = true;
}

const sessionCache = new Map<string, Promise<ort.InferenceSession>>();

/**
 * Try to load the external-data sidecar for a model.
 *
 * These models were exported in ONNX external-data format, so the big weight
 * tensors live in a file named "<model>.data" sitting next to the .onnx. The
 * web backend does NOT fetch this automatically, so we fetch it and hand it to
 * the session via the `externalData` option. The `path` must match the
 * location string baked into the model (its basename, e.g.
 * "detector_best.onnx.data").
 */
async function loadExternalData(modelUrl: string) {
  const dataUrl = `${modelUrl}.data`;
  const path = dataUrl.split("/").pop() as string;
  let res: Response;
  try {
    res = await fetch(dataUrl);
  } catch {
    return undefined; // network error — let create() surface the real problem
  }
  if (!res.ok) return undefined; // 404 -> model may be self-contained
  const data = new Uint8Array(await res.arrayBuffer());
  return [{ path, data }] as const;
}

/**
 * Load (and cache) an ONNX model from a public URL, e.g. "/model/detector_best.onnx".
 * Concurrent callers share the same in-flight promise. Automatically attaches
 * the "<model>.data" external-weights file when present.
 */
export function getSession(modelUrl: string): Promise<ort.InferenceSession> {
  configureRuntime();
  const existing = sessionCache.get(modelUrl);
  if (existing) return existing;

  const created = (async () => {
    const externalData = await loadExternalData(modelUrl);
    try {
      return await ort.InferenceSession.create(modelUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        ...(externalData ? { externalData } : {}),
      });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (!externalData && /external data|\.onnx\.data/i.test(msg)) {
        throw new Error(
          `Model "${modelUrl}" needs its external weights file "${modelUrl}.data", ` +
            `which was not found (HTTP fetch failed or 404). Copy the matching ` +
            `".onnx.data" file produced at export time into public/model/. ` +
            `Original error: ${msg}`,
        );
      }
      throw err;
    }
  })().catch((err) => {
    // Don't poison the cache on failure so a later retry can succeed.
    sessionCache.delete(modelUrl);
    throw err;
  });

  sessionCache.set(modelUrl, created);
  return created;
}

export { ort };
