export const MAX_FILE_BYTES = 160 * 1024 * 1024
export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.ogg',
  '.oga',
  '.m4a',
  '.aac',
  '.flac',
  '.opus',
  '.webm',
  '.aif',
  '.aiff',
] as const

export function isLikelyAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true
  const lower = file.name.toLowerCase()
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

interface FilePickerType {
  description: string
  accept: Record<string, string[]>
}

interface FilePickerOptions {
  multiple?: boolean
  types?: FilePickerType[]
  excludeAcceptAllOption?: boolean
}

interface FileSystemFileHandleLike {
  getFile: () => Promise<File>
}

interface WindowWithFilePicker extends Window {
  showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandleLike[]>
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

export async function pickLocalAudioFiles(): Promise<File[]> {
  const picker = (window as WindowWithFilePicker).showOpenFilePicker
  if (!picker) throw new Error('Il selettore file di sistema non è disponibile in questo browser')
  try {
    const handles = await picker({
      multiple: true,
      excludeAcceptAllOption: false,
      types: [
        {
          description: 'File audio',
          accept: {
            'audio/*': [...AUDIO_EXTENSIONS],
          },
        },
      ],
    })
    const files = await Promise.all(handles.map((handle) => handle.getFile()))
    return files
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return []
    throw new Error('Permesso di accesso ai file negato o selettore non disponibile')
  }
}

/** Stable local ID: re-importing the same file updates the existing entry. */
export function fileId(file: File): string {
  const input = `${file.name}|${file.size}|${file.lastModified}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `local_${(hash >>> 0).toString(36)}`
}
