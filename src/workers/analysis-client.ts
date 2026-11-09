import type { AnalysisResult } from '../types'

export interface AnalysisProgress {
  progress: number
  stage: string
}

interface WorkerResponse {
  type: 'progress' | 'result' | 'error'
  id: string
  progress?: number
  stage?: string
  result?: AnalysisResult
  message?: string
}

interface PendingJob {
  resolve: (result: AnalysisResult) => void
  reject: (error: Error) => void
  onProgress?: (progress: AnalysisProgress) => void
}

class AnalysisClient {
  private worker: Worker | null = null
  private pending = new Map<string, PendingJob>()
  private jobCounter = 0

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
      type: 'module',
      name: 'tandem-analysis',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data)
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Il worker di analisi si è arrestato')
      for (const job of this.pending.values()) job.reject(error)
      this.pending.clear()
      this.worker?.terminate()
      this.worker = null
    }
    return this.worker
  }

  private handleMessage(message: WorkerResponse): void {
    const job = this.pending.get(message.id)
    if (!job) return
    if (message.type === 'progress') {
      job.onProgress?.({
        progress: message.progress ?? 0,
        stage: message.stage ?? 'Analisi',
      })
      return
    }
    this.pending.delete(message.id)
    if (message.type === 'result' && message.result) {
      job.resolve(message.result)
    } else {
      job.reject(new Error(message.message || 'Analisi non riuscita'))
    }
  }

  analyse(
    samples: Float32Array,
    duration: number,
    onProgress?: (progress: AnalysisProgress) => void,
  ): Promise<AnalysisResult> {
    const worker = this.ensureWorker()
    const id = `analysis_${++this.jobCounter}`
    return new Promise<AnalysisResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
      const copy = samples.slice()
      worker.postMessage({ type: 'analyse', id, samples: copy, duration }, [copy.buffer])
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const job of this.pending.values()) job.reject(new Error('Analisi annullata'))
    this.pending.clear()
  }
}

export const analysisClient = new AnalysisClient()

/** Extracts a small mono representation for the worker without retaining a second full buffer. */
export function extractMonoSamples(
  buffer: AudioBuffer,
  targetRate = 11_025,
  maxSeconds = 900,
): Float32Array {
  const sourceRate = buffer.sampleRate
  const seconds = Math.min(buffer.duration, maxSeconds)
  const targetLength = Math.max(1, Math.floor(seconds * targetRate))
  const ratio = sourceRate / targetRate
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  const samples = new Float32Array(targetLength)
  for (let i = 0; i < targetLength; i += 1) {
    const sourceIndex = Math.min(left.length - 1, Math.floor(i * ratio))
    const a = left[sourceIndex] ?? 0
    const b = right ? (right[sourceIndex] ?? 0) : a
    samples[i] = (a + b) * 0.5
  }
  return samples
}
