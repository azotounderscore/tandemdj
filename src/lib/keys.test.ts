import { describe, expect, it } from 'vitest'
import { camelotHue, camelotToKey, keysAreCompatible, toCamelot } from './keys'

describe('Camelot wheel', () => {
  it('maps major keys to the B side', () => {
    expect(toCamelot('B', 'major')).toBe('1B')
    expect(toCamelot('F#', 'major')).toBe('2B')
    expect(toCamelot('Db', 'major')).toBe('3B')
    expect(toCamelot('C', 'major')).toBe('8B')
    expect(toCamelot('A', 'major')).toBe('11B')
    expect(toCamelot('E', 'major')).toBe('12B')
  })

  it('maps minor keys to the A side', () => {
    expect(toCamelot('Ab', 'minor')).toBe('1A')
    expect(toCamelot('Eb', 'minor')).toBe('2A')
    expect(toCamelot('C', 'minor')).toBe('5A')
    expect(toCamelot('A', 'minor')).toBe('8A')
    expect(toCamelot('F#', 'minor')).toBe('11A')
    expect(toCamelot('C#', 'minor')).toBe('12A')
  })

  it('accepts enharmonic spellings', () => {
    expect(toCamelot('G#', 'minor')).toBe(toCamelot('Ab', 'minor'))
    expect(toCamelot('C#', 'major')).toBe(toCamelot('Db', 'major'))
  })

  it('converts back to readable keys', () => {
    expect(camelotToKey('8A')).toBe('A minor')
    expect(camelotToKey('8B')).toBe('C major')
    expect(camelotToKey('1A')).toBe('Ab minor')
    expect(camelotToKey('not-a-key')).toBe('—')
  })

  it('detects harmonic compatibility', () => {
    expect(keysAreCompatible('8A', '8A')).toBe(true)
    expect(keysAreCompatible('8A', '9A')).toBe(true)
    expect(keysAreCompatible('12A', '1A')).toBe(true)
    expect(keysAreCompatible('8A', '8B')).toBe(true)
    expect(keysAreCompatible('8A', '5B')).toBe(false)
    expect(keysAreCompatible(null, '8A')).toBeNull()
  })

  it('assigns a stable hue to every Camelot number', () => {
    expect(camelotHue('1A')).toBe(330)
    expect(camelotHue('8A')).toBe(310)
    expect(camelotHue(null)).toBe(210)
  })
})
