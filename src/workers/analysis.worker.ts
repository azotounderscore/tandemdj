/// <reference lib="webworker" />
import { analyseSamples } from './analysis-core'

interface AnalyseRequest {
  type: 'analyse'
  id: string
  samples: Float32Array
  duration: number
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalyseRequest>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const data = event.data
  if (!data || data.type !== 'analyse') return
  try {
    const result = analyseSamples(data.samples, data.duration, (progress, stage) => {
      scope.postMessage({ type: 'progress', id: data.id, progress, stage })
    })
    scope.postMessage({ type: 'result', id: data.id, result })
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id: data.id,
      message: error instanceof Error ? error.message : 'Analisi non riuscita',
    })
  }
}
