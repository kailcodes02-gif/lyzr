// One-shot codemod: dark theme -> light theme across app/ and components/.
// Ordered replacements (longest/most-specific first). text-white is preserved
// on lines that also carry a solid colored background (buttons, gradients,
// checked states) so white-on-color contrast survives.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const ORDERED = [
  // page shells / fixed hexes
  ['bg-[#0a0a0f]/80', 'bg-white/85'],
  ['bg-[#0a0a0f]', 'bg-zinc-50'],
  ['bg-[#0b0b10]', 'bg-white'],
  ['bg-[#0c0c12]', 'bg-white'],
  ['bg-[#12121a]', 'bg-white'],
  ['border-[#0a0a0f]', 'border-white'],
  // dark surfaces
  ['bg-zinc-900/20', 'bg-white'],
  ['bg-zinc-900/30', 'bg-white'],
  ['bg-zinc-900/40', 'bg-white'],
  ['bg-zinc-900/60', 'bg-white'],
  ['bg-zinc-900', 'bg-white'],
  ['bg-zinc-800/50', 'bg-zinc-200/60'],
  ['bg-zinc-800', 'bg-zinc-200'],
  ['bg-zinc-700', 'bg-zinc-300'],
  // translucent whites -> light greys (hover variants first)
  ['hover:bg-white/10', 'hover:bg-zinc-200/70'],
  ['hover:bg-white/5', 'hover:bg-zinc-100'],
  ['hover:bg-white/[0.06]', 'hover:bg-zinc-100'],
  ['bg-white/[0.01]', 'bg-zinc-100/40'],
  ['bg-white/[0.02]', 'bg-zinc-100/50'],
  ['bg-white/[0.03]', 'bg-zinc-100/60'],
  ['bg-white/[0.04]', 'bg-zinc-100/70'],
  ['bg-white/[0.05]', 'bg-zinc-100'],
  ['bg-white/[0.06]', 'bg-zinc-100'],
  ['bg-white/10', 'bg-zinc-200/70'],
  ['bg-white/5', 'bg-zinc-100'],
  // borders
  ['hover:border-white/10', 'hover:border-zinc-300'],
  ['hover:border-white/[0.12]', 'hover:border-zinc-300'],
  ['border-white/[0.06]', 'border-zinc-200'],
  ['border-white/[0.12]', 'border-zinc-300'],
  ['border-white/20', 'border-zinc-300'],
  ['border-white/15', 'border-zinc-300'],
  ['border-white/10', 'border-zinc-300'],
  ['border-white/5', 'border-zinc-200'],
  // text scale (dark -> light)
  ['text-white/90', 'text-zinc-900'],
  ['group-hover:text-white', 'group-hover:text-zinc-900'],
  ['hover:text-white', 'hover:text-zinc-900'],
  ['text-zinc-100', 'text-zinc-900'],
  ['hover:text-zinc-200', 'hover:text-zinc-800'],
  ['hover:text-zinc-300', 'hover:text-zinc-700'],
  ['text-zinc-200', 'text-zinc-800'],
  ['text-zinc-300', 'text-zinc-700'],
  ['text-zinc-400', 'text-zinc-600'],
  ['text-zinc-600 uppercase', 'text-zinc-500 uppercase'], // section labels stay soft
  // colored accents tuned for light bg
  ['group-hover:text-blue-300', 'group-hover:text-blue-600'],
  ['hover:text-blue-300', 'hover:text-blue-700'],
  ['hover:text-red-300', 'hover:text-red-700'],
  ['text-blue-200', 'text-blue-800'],
  ['text-blue-300', 'text-blue-600'],
  ['text-blue-400', 'text-blue-600'],
  ['text-emerald-300', 'text-emerald-600'],
  ['text-emerald-400', 'text-emerald-600'],
  ['text-red-300', 'text-red-600'],
  ['text-red-400', 'text-red-600'],
  ['text-violet-300', 'text-violet-600'],
  ['text-violet-400', 'text-violet-600'],
  ['text-amber-400', 'text-amber-600'],
  ['text-orange-400', 'text-orange-600'],
  // translucent colored surfaces
  ['bg-blue-500/10', 'bg-blue-50'],
  ['bg-blue-500/[0.15]', 'bg-blue-100'],
  ['hover:bg-blue-500/20', 'hover:bg-blue-100'],
  ['border-blue-500/20', 'border-blue-200'],
  ['border-blue-500/30', 'border-blue-300'],
  ['bg-emerald-500/10', 'bg-emerald-50'],
  ['border-emerald-500/20', 'border-emerald-200'],
  ['bg-red-500/10', 'bg-red-50'],
  ['hover:bg-red-500/10', 'hover:bg-red-50'],
  ['border-red-500/20', 'border-red-200'],
  ['bg-zinc-500/10', 'bg-zinc-100'],
  ['border-zinc-500/20', 'border-zinc-300'],
  ['border-violet-500/30', 'border-violet-300'],
  ['bg-violet-500/10', 'bg-violet-50'],
  // shadows
  ['hover:shadow-black/20', 'hover:shadow-zinc-400/30'],
]

// keep white text when the same line paints a solid colored background
const KEEP_WHITE = /bg-(blue|red|emerald|violet|orange|amber|green)-[456]00|bg-gradient|data-\[state=checked\]/

const exts = new Set(['.tsx', '.ts'])
const files = []
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (e === 'node_modules' || e.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p)
    else if (exts.has(p.slice(p.lastIndexOf('.')))) files.push(p)
  }
}
walk(join(root, 'app'))
walk(join(root, 'components'))

let changed = 0
for (const f of files) {
  const before = readFileSync(f, 'utf8')
  const lines = before.split('\n').map(line => {
    let out = line
    for (const [from, to] of ORDERED) out = out.split(from).join(to)
    // generic text-white -> dark text, except on colored/solid backgrounds
    if (out.includes('text-white') && !KEEP_WHITE.test(out)) {
      out = out.split('text-white').join('text-zinc-900')
    }
    return out
  })
  const after = lines.join('\n')
  if (after !== before) {
    writeFileSync(f, after)
    changed++
  }
}
console.log(`light-mode codemod: rewrote ${changed}/${files.length} files`)
