// Genera seed/boss_spawns.json: frecuencia de aparición de cada boss (intervalos entre apariciones en las
// Kill Statistics oficiales, juntando todos los mundos) y las últimas apariciones por mundo.
// Fuente: historial diario de https://www.tibia.com/community/?subtopic=killstatistics (vía TibiaData) que
// publica el repositorio público github.com/tibiamaps/tibia-kill-stats (un JSON por mundo y día).
// Uso: node scripts/build-boss-stats.ts [--repo <carpeta>] [--worlds antica,bona]
// Clona sin blobs y baja un mundo a la vez (sparse checkout), así nunca hay más de ~80 MB en disco.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOSSES } from '../src/core/domain/bosses/list.ts'
import { bossesByRace, diffDays, mergeSameSpawn, sightingsFromEntries, type Sighting } from '../src/core/domain/bosses/spawn.ts'

const REPO = 'https://github.com/tibiamaps/tibia-kill-stats.git'
const SEED = join(import.meta.dirname, '..', 'seed', 'boss_spawns.json')
/** Mínimo de casos "en riesgo" para confiar en la probabilidad de un día concreto. */
const MIN_AT_RISK = 20
const MAX_DAY = 400
/** Últimas apariciones por mundo y boss que se guardan en el seed. */
const KEEP_LAST = 3

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const repo = arg('repo') ?? join(mkdtempSync(join(tmpdir(), 'tt-killstats-')), 'repo')
if (!existsSync(join(repo, '.git'))) {
  console.log(`Clonando ${REPO} (sin blobs) en ${repo}…`)
  execFileSync('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', '--depth', '1', REPO, repo], { stdio: 'inherit' })
  git(['sparse-checkout', 'set', '--no-cone', '/README.md'], repo)
  git(['checkout', '-q'], repo)
}
const only = arg('worlds')?.split(',').map((w) => w.trim().toLowerCase())
const worlds = git(['ls-tree', '-d', '--name-only', 'HEAD', 'data/'], repo)
  .split('\n')
  .map((p) => p.replace(/^data\//, '').trim())
  .filter((w) => w && !w.startsWith('_') && (!only || only.includes(w)))

const byRace = bossesByRace(BOSSES)
/** world → boss → apariciones (ya ordenadas por día). */
const sightings = new Map<string, Map<string, Sighting[]>>()
const dataThrough = new Map<string, string>()
const dataFrom = new Map<string, string>()
const worldNames = new Map<string, string>()
let filesRead = 0

for (const [i, w] of worlds.entries()) {
  git(['sparse-checkout', 'set', '--no-cone', `/data/${w}/*`], repo)
  const dir = join(repo, 'data', w)
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  const perBoss = new Map<string, Sighting[]>()
  for (const f of files) {
    const day = f.slice(0, 10)
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { killstatistics: { world: string; entries: { race: string; last_day_killed: number; last_day_players_killed: number }[] } }
    worldNames.set(w, data.killstatistics.world)
    for (const s of sightingsFromEntries(data.killstatistics.entries, day, byRace)) {
      const list = perBoss.get(s.boss) ?? []
      list.push({ day: s.day, killed: s.killed, playersKilled: s.playersKilled })
      perBoss.set(s.boss, list)
    }
    filesRead++
  }
  sightings.set(w, perBoss)
  if (files.length) {
    dataFrom.set(w, files[0]!.slice(0, 10))
    dataThrough.set(w, files.at(-1)!.slice(0, 10))
  }
  console.log(`${i + 1}/${worlds.length} ${w}: ${files.length} días, ${[...perBoss.values()].reduce((s, l) => s + l.length, 0)} apariciones`)
}
git(['sparse-checkout', 'set', '--no-cone', '/README.md'], repo)

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!

const bosses = BOSSES.map((b) => {
  const events = new Array<number>(MAX_DAY + 2).fill(0)
  const atRisk = new Array<number>(MAX_DAY + 2).fill(0)
  const intervals: number[] = []
  let appearances = 0
  for (const [w, perBoss] of sightings) {
    const list = mergeSameSpawn(perBoss.get(b.name) ?? [])
    appearances += list.length
    const end = dataThrough.get(w)!
    for (let k = 1; k < list.length; k++) {
      const d = Math.min(MAX_DAY + 1, diffDays(list[k - 1]!.day, list[k]!.day))
      intervals.push(d)
      events[d]!++
      for (let x = 1; x <= d; x++) atRisk[x]!++
    }
    // Intervalo abierto al final de los datos: sin aparición durante `c` días (censurado).
    if (list.length) {
      const c = Math.min(MAX_DAY + 1, diffDays(list.at(-1)!.day, end))
      for (let x = 1; x <= c; x++) atRisk[x]!++
    }
  }
  // Probabilidad diaria (hazard): de los casos que llevaban d−1 días sin aparecer, cuántos aparecieron el día d.
  let lastReliable = 0
  for (let d = 1; d <= MAX_DAY; d++) if (atRisk[d]! >= MIN_AT_RISK) lastReliable = d
  const hazard = Array.from({ length: lastReliable }, (_, i) => Math.round((events[i + 1]! / atRisk[i + 1]!) * 10_000) / 10_000)
  let tailEvents = 0
  let tailRisk = 0
  for (let d = lastReliable + 1; d <= MAX_DAY + 1; d++) {
    tailEvents += events[d]!
    tailRisk += atRisk[d]!
  }
  const sorted = [...intervals].sort((x, y) => x - y)
  return {
    name: b.name,
    race: b.race,
    group: b.group,
    appearances,
    intervals: sorted.length
      ? { n: sorted.length, min: sorted[0]!, p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), max: sorted.at(-1)! }
      : null,
    hazard,
    tailHazard: tailRisk ? Math.round((tailEvents / tailRisk) * 10_000) / 10_000 : null,
  }
})

// Últimas apariciones por mundo: [día de la estadística, muertes del boss, jugadores que mató].
const worldsOut: Record<string, { from: string; through: string; last: Record<string, [string, number, number][]> }> = {}
for (const [w, perBoss] of sightings) {
  const last: Record<string, [string, number, number][]> = {}
  for (const [boss, list] of perBoss) last[boss] = mergeSameSpawn(list).slice(-KEEP_LAST).map((s) => [s.day, s.killed, s.playersKilled])
  worldsOut[worldNames.get(w) ?? w] = { from: dataFrom.get(w)!, through: dataThrough.get(w)!, last }
}

const days = [...dataThrough.values()].sort()
writeFileSync(
  SEED,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: 'tibia.com Kill Statistics (vía TibiaData), historial diario de github.com/tibiamaps/tibia-kill-stats',
      method: 'Probabilidad diaria = apariciones el día d / casos que llevaban d−1 días sin aparecer (todos los mundos juntos, con intervalos abiertos censurados).',
      dataFrom: [...dataFrom.values()].sort()[0] ?? null,
      dataThrough: days.at(-1) ?? null,
      filesRead,
      minAtRisk: MIN_AT_RISK,
      bosses,
      worlds: worldsOut,
    },
    null,
    0,
  ) + '\n',
)
console.log(`Listo: ${bosses.length} bosses, ${Object.keys(worldsOut).length} mundos, ${filesRead} archivos → ${SEED}`)
