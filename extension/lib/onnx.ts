import * as ort from "onnxruntime-web"

let session = null

export async function loadOnnxModel() {
    if (session) return session

    const modelPath = chrome.runtime.getURL("model/detector_best.onnx")

    session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["wasm"]
    })

    return session
}

export function tokenize(text) {
    return text
        .split("")
        .map((char) => char.charCodeAt(0))
        .slice(0, 128)
}

export async function predictText(text) {
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

    return Array.from(result[outputName].data)
}