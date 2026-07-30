import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pdfjsRoot = resolve(projectRoot, 'node_modules/pdfjs-dist')
const targetRoot = resolve(projectRoot, 'public/pdfjs')

await rm(targetRoot, { recursive: true, force: true })
await mkdir(targetRoot, { recursive: true })

await Promise.all([
  cp(resolve(pdfjsRoot, 'cmaps'), resolve(targetRoot, 'cmaps'), { recursive: true }),
  cp(resolve(pdfjsRoot, 'standard_fonts'), resolve(targetRoot, 'standard_fonts'), { recursive: true }),
])
