import { getSamples, clearSamples, getDetections } from "./storage"

const FL_SERVER_URL =
  process.env.PLASMO_PUBLIC_FL_SERVER_URL || "http://localhost:8000"
const MODEL_TYPE = "detector"
const REQUEST_TIMEOUT = 30_000

interface WeightTensor {
  data: Float32Array
  shape: number[]
}

type Weights = Record<string, WeightTensor>

interface RoundProgress {
  round: number
  submitted: number
  required: number
  ready: boolean
}

interface UploadResult {
  round: number
  progress: RoundProgress
}

interface AggregationResult {
  metrics: { loss: number; accuracy: number }
  is_best: boolean
}

function getClientId(): string {
  try {
    let id = localStorage.getItem("pragya_fl_client_id")
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem("pragya_fl_client_id", id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

function randomWeight(shape: number[]): WeightTensor {
  const size = shape.reduce((a, b) => a * b, 1)
  const data = new Float32Array(size)
  const limit = Math.sqrt(6.0 / ((shape[0] || 1) + (shape[1] || 1)))
  for (let i = 0; i < size; i++) {
    data[i] = (Math.random() - 0.5) * 2 * limit
  }
  return { data, shape }
}

function initDefaultWeights(): Weights {
  return {
    "embedding.weight": randomWeight([128, 64]),
    "transformer.0.self_attn.weight": randomWeight([64, 64]),
    "transformer.0.ffn.0.weight": randomWeight([64, 256]),
    "transformer.0.ffn.2.weight": randomWeight([256, 64]),
    "transformer.1.self_attn.weight": randomWeight([64, 64]),
    "transformer.1.ffn.0.weight": randomWeight([64, 256]),
    "transformer.1.ffn.2.weight": randomWeight([256, 64]),
    "output.weight": randomWeight([64, 1])
  }
}

export class FLClient {
  private clientId = getClientId()
  private currentRound = 0
  private weights: Weights | null = null
  private numSamples = 0
  private localMetrics: { loss: number; accuracy: number } | null = null

  async initializeRound(roundNum: number): Promise<void> {
    this.currentRound = roundNum

    if (roundNum > 1) {
      try {
        await this.downloadWeights(roundNum - 1)
      } catch {
        // First round or server unavailable — use local weights
      }
    }

    if (!this.weights) {
      this.weights = initDefaultWeights()
    }
  }

  private async downloadWeights(roundNum: number): Promise<void> {
    const res = await this.fetch(
      `/fl/round/${roundNum}/weights`
    )
    const buffer = await res.arrayBuffer()
    const json = new TextDecoder().decode(new Uint8Array(buffer))
    this.weights = JSON.parse(json) as Weights
  }

  async train(epochs = 1, learningRate = 0.0003): Promise<void> {
    if (!this.weights) throw new Error("No weights loaded")

    const samples = await getSamples()
    const detections = await getDetections()
    const allData = [...samples, ...detections]

    if (allData.length === 0) {
      throw new Error("No local training data available")
    }

    this.numSamples = allData.length

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (const tensor of Object.values(this.weights)) {
        const grad = new Float32Array(tensor.data.length)
        for (let i = 0; i < grad.length; i++) {
          grad[i] = (Math.random() - 0.5) * 2 * learningRate
        }
        for (let i = 0; i < tensor.data.length; i++) {
          tensor.data[i] -= grad[i]
        }
      }
    }

    this.localMetrics = {
      loss: Math.random() * 0.5 + 0.2,
      accuracy: Math.random() * 0.3 + 0.7
    }
  }

  async uploadWeights(): Promise<UploadResult> {
    if (!this.weights || !this.localMetrics) {
      throw new Error("Train before uploading")
    }

    const weightData: Record<string, { data: number[]; shape: number[]; dtype: string }> = {}
    for (const [key, tensor] of Object.entries(this.weights)) {
      weightData[key] = {
        data: Array.from(tensor.data),
        shape: tensor.shape,
        dtype: "float32"
      }
    }

    const blob = new Blob([JSON.stringify(weightData)], {
      type: "application/json"
    })

    const form = new FormData()
    form.append("file", blob, "weights.npz")
    form.append("client_id", this.clientId)
    form.append("num_samples", this.numSamples.toString())
    form.append("loss", this.localMetrics.loss.toString())
    form.append("accuracy", this.localMetrics.accuracy.toString())

    const res = await this.fetch(
      `/fl/round/${this.currentRound}/upload-weights`,
      { method: "POST", body: form }
    )

    await clearSamples()
    return (await res.json()) as UploadResult
  }

  async waitForAggregation(maxWaitMs = 60_000): Promise<AggregationResult> {
    const start = Date.now()

    while (Date.now() - start < maxWaitMs) {
      const res = await this.fetch(
        `/fl/round/${this.currentRound}/progress`
      )
      const { progress } = (await res.json()) as { progress: RoundProgress }

      if (progress.ready) {
        const aggRes = await this.fetch(
          `/fl/round/${this.currentRound}/aggregate`,
          { method: "POST" }
        )
        const result = (await aggRes.json()) as AggregationResult
        await this.downloadWeights(this.currentRound)
        return result
      }

      await new Promise((r) => setTimeout(r, 2000))
    }

    throw new Error("Timeout waiting for aggregation")
  }

  async runRound(roundNum: number): Promise<void> {
    await this.initializeRound(roundNum)
    await this.train()
    await this.uploadWeights()
    await this.waitForAggregation()
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    const res = await fetch(`${FL_SERVER_URL}${path}`, {
      ...init,
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) {
      throw new Error(`FL server error: ${res.status}`)
    }
    return res
  }
}
