import { useEffect, useRef } from 'react'

interface WaveformCanvasProps {
  peaks: number[] | null
  seed?: number
  variant?: 'track' | 'empty'
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[] | null,
  seed: number,
  variant: 'track' | 'empty',
): void {
  const context = canvas.getContext('2d')
  const parent = canvas.parentElement
  if (!context || !parent) return
  const rect = parent.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)

  const middle = height / 2

  // Studio-style vertical grid.
  context.save()
  context.strokeStyle = 'rgba(255, 255, 255, 0.035)'
  context.lineWidth = 1
  for (let index = 1; index < 20; index += 1) {
    const x = Math.round((width / 20) * index) + 0.5
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }
  context.strokeStyle = 'rgba(255, 255, 255, 0.07)'
  context.beginPath()
  context.moveTo(0, middle + 0.5)
  context.lineTo(width, middle + 0.5)
  context.stroke()
  context.restore()

  if (!peaks || peaks.length === 0 || variant === 'empty') {
    context.save()
    context.setLineDash([2, 5])
    context.strokeStyle = 'rgba(245, 241, 232, 0.16)'
    context.beginPath()
    context.moveTo(0, middle + 0.5)
    context.lineTo(width, middle + 0.5)
    context.stroke()
    context.restore()
    return
  }

  const sample = (x: number): number => {
    const index = Math.min(peaks.length - 1, Math.max(0, Math.floor((x / width) * peaks.length)))
    const value = peaks[index] ?? 0
    return Math.min(1, Math.max(0, value))
  }

  // Blue transient spikes sit behind and beyond the amber body.
  context.save()
  context.strokeStyle = 'rgba(70, 146, 255, 0.88)'
  context.lineWidth = 1.4
  context.beginPath()
  for (let x = 0; x < width; x += 2) {
    const value = sample(x)
    const detail = 0.64 + 0.36 * Math.abs(Math.sin(x * 0.71 + seed * 1.37))
    const spike = (0.2 + 0.8 * Math.pow(value, 0.86)) * height * 0.44 * detail
    context.moveTo(x + 0.5, middle - spike)
    context.lineTo(x + 0.5, middle + spike)
  }
  context.stroke()
  context.restore()

  // Amber body, mirrored around the centre line.
  const bodyGradient = context.createLinearGradient(0, 0, 0, height)
  bodyGradient.addColorStop(0, 'rgba(210, 126, 42, 0.92)')
  bodyGradient.addColorStop(0.36, 'rgba(246, 177, 78, 0.98)')
  bodyGradient.addColorStop(0.5, 'rgba(255, 244, 216, 0.99)')
  bodyGradient.addColorStop(0.64, 'rgba(246, 177, 78, 0.98)')
  bodyGradient.addColorStop(1, 'rgba(210, 126, 42, 0.92)')

  context.save()
  context.beginPath()
  for (let x = 0; x <= width; x += 2) {
    const value = Math.pow(sample(x), 0.9)
    const y = middle - value * height * 0.3 - 0.6
    if (x === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  for (let x = width; x >= 0; x -= 2) {
    const value = Math.pow(sample(x), 0.9)
    const y = middle + value * height * 0.3 + 0.6
    context.lineTo(x, y)
  }
  context.closePath()
  context.fillStyle = bodyGradient
  context.fill()
  context.restore()

  // Bright cream core gives the waveform its characteristic centre.
  context.save()
  context.beginPath()
  for (let x = 0; x <= width; x += 2) {
    const value = Math.pow(sample(x), 1.02)
    const shimmer = 0.54 + 0.46 * Math.abs(Math.sin(x * 0.19 + seed * 2.13))
    const y = middle - value * height * 0.19 * shimmer
    if (x === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  for (let x = width; x >= 0; x -= 2) {
    const value = Math.pow(sample(x), 1.02)
    const shimmer = 0.54 + 0.46 * Math.abs(Math.sin(x * 0.19 + seed * 2.13))
    const y = middle + value * height * 0.19 * shimmer
    context.lineTo(x, y)
  }
  context.closePath()
  context.fillStyle = 'rgba(255, 248, 227, 0.95)'
  context.fill()
  context.restore()
}

export function WaveformCanvas({ peaks, seed = 1, variant = 'track' }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => drawWaveform(canvas, peaks, seed, variant)
    draw()
    const observer = new ResizeObserver(draw)
    if (canvas.parentElement) observer.observe(canvas.parentElement)
    return () => observer.disconnect()
  }, [peaks, seed, variant])

  return <canvas ref={canvasRef} className="wave-canvas" aria-hidden="true" />
}
