import { parseGp, type Gp } from '../money/gp'

// Parser del texto que copia el "Party Hunt Analyzer" del cliente:
//   Session data: From ... to ...
//   Session: 01:23h
//   Loot Type: Leader
//   Loot: 1,234,567
//   Supplies: 234,567
//   Balance: 1,000,000
//   Name (Leader)
//       Loot: ...  Supplies: ...  Balance: ...  Damage: ...  Healing: ...

export interface PartyMember {
  name: string
  leader: boolean
  loot: Gp
  supplies: Gp
  balance: Gp
  damage: number | null
  healing: number | null
}

export interface PartySession {
  totalLoot: Gp | null
  totalSupplies: Gp | null
  totalBalance: Gp
  members: PartyMember[]
}

export interface Transfer {
  from: string
  to: string
  amount: Gp
  command: string
}

export interface SplitResult {
  session: PartySession
  sharePerMember: Gp
  /** Oro que sobra al dividir en partes enteras; se queda con quien ya lo tiene. */
  remainder: Gp
  transfers: Transfer[]
}

const KV = /^([A-Za-z ]+):\s*(.+)$/

export function parsePartySession(text: string): PartySession {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const totals: Record<string, string> = {}
  const members: PartyMember[] = []
  let current: (Partial<PartyMember> & { name: string; leader: boolean }) | null = null

  const flush = () => {
    if (!current) return
    if (current.loot === undefined || current.supplies === undefined || current.balance === undefined) {
      throw new Error(`Faltan Loot/Supplies/Balance para ${current.name}`)
    }
    members.push({ damage: null, healing: null, ...current } as PartyMember)
  }

  for (const line of lines) {
    const kv = KV.exec(line)
    const isKnownKey = kv && ['loot', 'supplies', 'balance', 'damage', 'healing', 'session data', 'session', 'loot type'].includes(kv[1]!.trim().toLowerCase())
    if (!kv || !isKnownKey) {
      flush()
      current = { name: line.replace(/\s*\(Leader\)\s*$/i, '').trim(), leader: /\(Leader\)\s*$/i.test(line) }
      continue
    }
    const key = kv[1]!.trim().toLowerCase()
    const value = kv[2]!.trim()
    if (!current) {
      totals[key] = value
      continue
    }
    const n = parseGp(value)
    if (n === null) throw new Error(`Valor inválido en "${line}"`)
    if (key === 'loot') current.loot = n
    else if (key === 'supplies') current.supplies = n
    else if (key === 'balance') current.balance = n
    else if (key === 'damage') current.damage = n
    else if (key === 'healing') current.healing = n
  }
  flush()

  if (members.length === 0) throw new Error('No se encontraron jugadores en el texto')
  const total = (k: string) => (totals[k] !== undefined ? parseGp(totals[k]!) : null)
  const totalBalance = total('balance') ?? members.reduce((s, m) => s + m.balance, 0)
  return { totalLoot: total('loot'), totalSupplies: total('supplies'), totalBalance, members }
}

/** Reparte el balance en partes iguales y genera las transferencias mínimas (de quien tiene de más a quien tiene de menos). */
export function splitLoot(session: PartySession): SplitResult {
  const n = session.members.length
  const sum = session.members.reduce((s, m) => s + m.balance, 0)
  const share = Math.floor(sum / n)
  const remainder = sum - share * n
  const diffs = session.members.map((m) => ({ name: m.name, diff: m.balance - share }))
  const payers = diffs.filter((d) => d.diff > 0).sort((a, b) => b.diff - a.diff)
  const receivers = diffs.filter((d) => d.diff < 0).sort((a, b) => a.diff - b.diff)

  const transfers: Transfer[] = []
  for (const payer of payers) {
    for (const receiver of receivers) {
      // El resto de la división entera lo absorben los pagadores (no se transfiere).
      if (payer.diff <= 0) break
      const amount = Math.min(payer.diff, -receiver.diff)
      if (amount <= 0) continue
      transfers.push({ from: payer.name, to: receiver.name, amount, command: `transfer ${amount} to ${receiver.name}` })
      payer.diff -= amount
      receiver.diff += amount
    }
  }
  return { session, sharePerMember: share, remainder, transfers }
}
