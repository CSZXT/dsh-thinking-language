// Inspect a DSH session log: report the language mix of reasoning (thinking) blocks.
// The log is concatenated zstd frames; decode each frame separately.
// Usage: node session-reasoning.mjs <session.v4.jsonl.zstd> [sampleChars]
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const sampleChars = Number(process.argv[3] ?? 400)
if (!file) {
  console.error('usage: node session-reasoning.mjs <session.v4.jsonl.zstd> [sampleChars]')
  process.exit(2)
}

const buf = readFileSync(file)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function frameStarts(buffer, from = 0) {
  const starts = []
  let i = buffer.indexOf(MAGIC, from)
  while (i >= 0) {
    starts.push(i)
    i = buffer.indexOf(MAGIC, i + 4)
  }
  return starts
}

const starts = frameStarts(buf)
if (starts[0] !== 0) starts.unshift(0)

const parts = []
let decodedFrames = 0
let failedFrames = 0
for (let i = 0; i < starts.length; i++) {
  const end = i + 1 < starts.length ? starts[i + 1] : buf.length
  const frame = buf.subarray(starts[i], end)
  try {
    parts.push(zstdDecompressSync(frame))
    decodedFrames++
  } catch {
    failedFrames++
  }
}

const text = Buffer.concat(parts).toString('utf8')
const lines = text.split('\n').filter((line) => line.trim().length > 0)

const stats = { han: 0, latin: 0, kana: 0, hangul: 0 }
const samples = []
const typeCounts = new Map()
let reasoningChars = 0

function walk(node, onReasoning, onType) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, onReasoning, onType)
    return
  }
  if (node.type === 'reasoning' && typeof node.text === 'string') onReasoning(node.text)
  if (typeof node.type === 'string') onType(node.type)
  for (const value of Object.values(node)) walk(value, onReasoning, onType)
}

let parseErrors = 0
for (const line of lines) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    parseErrors++
    continue
  }
  walk(
    event,
    (reason) => {
      reasoningChars += reason.length
      for (const ch of reason) {
        const cp = ch.codePointAt(0)
        if (cp >= 0x4e00 && cp <= 0x9fff) stats.han++
        else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) stats.latin++
        else if (cp >= 0x3040 && cp <= 0x30ff) stats.kana++
        else if (cp >= 0xac00 && cp <= 0xd7af) stats.hangul++
      }
      if (reason.trim().length > 0) samples.push(reason)
    },
    (type) => typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1),
  )
}

console.log(`file: ${file}`)
console.log(`frames: ${starts.length} decoded: ${decodedFrames} failed: ${failedFrames}`)
console.log(`log lines: ${lines.length}${parseErrors ? ` (unparsed: ${parseErrors})` : ''}`)
console.log(
  'types:',
  [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([k, v]) => `${k}:${v}`)
    .join(' '),
)
console.log(`reasoning blocks: ${samples.length}  chars: ${reasoningChars}`)
console.log(`han: ${stats.han}  latin: ${stats.latin}  kana: ${stats.kana}  hangul: ${stats.hangul}`)
if (stats.han + stats.latin > 0) {
  console.log(`han share of han+latin: ${((stats.han / (stats.han + stats.latin)) * 100).toFixed(1)}%`)
}
const shown = samples.slice(Number(process.env.SKIP ?? 0), Number(process.env.SKIP ?? 0) + Number(process.env.SAMPLES ?? 2))
for (const [i, sample] of shown.entries()) {
  console.log(`\n--- reasoning sample ${i + 1} (${sample.length} chars) ---\n${sample.slice(0, sampleChars)}`)
}
