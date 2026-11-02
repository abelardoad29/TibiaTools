// Rashid cambia de ciudad con el server save diario (10:00 hora de Alemania, CET/CEST).
// Antes de las 10:00 sigue en la ciudad del día anterior.

export const SERVER_TIME_ZONE = 'Europe/Berlin'
export const SERVER_SAVE_HOUR = 10

export type Weekday = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'

export const RASHID_SCHEDULE: Record<Weekday, string> = {
  Monday: 'Svargrond',
  Tuesday: 'Liberty Bay',
  Wednesday: 'Port Hope',
  Thursday: 'Ankrahmun',
  Friday: 'Darashia',
  Saturday: 'Edron',
  Sunday: 'Carlin',
}

const WEEKDAYS: Weekday[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface ServerParts {
  year: number
  month: number
  day: number
  hour: number
}

function serverParts(now: Date): ServerParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SERVER_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') }
}

/** Día "de servidor": cambia a las 10:00 hora de Alemania, no a medianoche. */
export function serverWeekday(now: Date): Weekday {
  const p = serverParts(now)
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day))
  if (p.hour < SERVER_SAVE_HOUR) date.setUTCDate(date.getUTCDate() - 1)
  return WEEKDAYS[date.getUTCDay()]!
}

export function rashidLocation(now: Date): { city: string; weekday: Weekday; nextCity: string } {
  const weekday = serverWeekday(now)
  const next = WEEKDAYS[(WEEKDAYS.indexOf(weekday) + 1) % 7]!
  return { city: RASHID_SCHEDULE[weekday], weekday, nextCity: RASHID_SCHEDULE[next] }
}
