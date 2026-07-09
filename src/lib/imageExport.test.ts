import { describe, expect, it } from 'vitest'
import { getImageExportExtension, getImageExportLabel, makeImageOutputName } from './imageExport'

describe('image export naming', () => {
  it('uses one image file name for a single-page PDF output', () => {
    expect(makeImageOutputName('资料_p001.pdf', 1, 1, 'jpeg')).toBe('资料_p001.jpg')
    expect(makeImageOutputName('资料_p001.pdf', 1, 1, 'png')).toBe('资料_p001.png')
  })

  it('places multi-page output images under a folder named after the PDF output', () => {
    expect(makeImageOutputName('资料_p001-p012.pdf', 2, 12, 'jpeg')).toBe('资料_p001-p012/p002.jpg')
  })

  it('provides export metadata for labels and extensions', () => {
    expect(getImageExportExtension('jpeg')).toBe('jpg')
    expect(getImageExportExtension('png')).toBe('png')
    expect(getImageExportLabel('jpeg')).toBe('JPG')
    expect(getImageExportLabel('png')).toBe('PNG')
  })
})
