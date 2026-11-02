import { useMemo, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import clsx from 'clsx'
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, X } from 'lucide-react'

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-panel', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({ variant = 'secondary', busy, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
        variant === 'secondary' && 'border border-line bg-panel-2 hover:border-accent',
        variant === 'ghost' && 'hover:bg-panel-2',
        variant === 'danger' && 'border border-bad/50 text-bad hover:bg-bad/10',
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('flex flex-col gap-1 text-sm', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

const inputCls = 'rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-60'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />
}

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={clsx(inputCls, props.className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** Selector de tres estados (sí / no / sin confirmar) para datos que el usuario confirma. */
export function TriState({ value, onChange, label }: { value: boolean | null; onChange: (v: boolean | null) => void; label: string }) {
  const opts: { v: boolean | null; t: string }[] = [
    { v: true, t: 'Sí' },
    { v: false, t: 'No' },
    { v: null, t: '?' },
  ]
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <div className="flex overflow-hidden rounded-lg border border-line">
        {opts.map((o) => (
          <button key={String(o.v)} type="button" onClick={() => onChange(o.v)} className={clsx('px-2.5 py-1 text-xs', value === o.v ? 'bg-accent text-accent-ink' : 'bg-panel-2 hover:bg-panel')}>
            {o.t}
          </button>
        ))}
      </div>
    </div>
  )
}

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'accent'

export function Badge({ tone = 'neutral', children, title, icon }: { tone?: Tone; children: ReactNode; title?: string; icon?: ReactNode }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'border-line text-muted',
        tone === 'good' && 'border-good/40 bg-good/10 text-good',
        tone === 'bad' && 'border-bad/40 bg-bad/10 text-bad',
        tone === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
        tone === 'info' && 'border-info/40 bg-info/10 text-info',
        tone === 'accent' && 'border-accent/40 bg-accent/10 text-accent',
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx('-mb-px border-b-2 px-3 py-2 text-sm', value === t.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={clsx('num text-lg font-semibold', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</div>
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  )
}

export function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-1 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
      {items.map((w) => (
        <li key={w} className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {w}
        </li>
      ))}
    </ul>
  )
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal className={clsx('max-h-[90vh] w-full overflow-auto rounded-xl border border-line bg-panel', wide ? 'max-w-5xl' : 'max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded p-1 hover:bg-panel-2">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  sort?: (row: T) => number | string | null
  align?: 'right' | 'left' | 'center'
  className?: string
}

/** Tabla ordenable con paginación simple. */
export function DataTable<T>({ rows, columns, rowKey, pageSize = 50, onRowClick, empty = 'Sin datos', initialSort }: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  pageSize?: number
  onRowClick?: (row: T) => void
  empty?: ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
}) {
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    const k = col.sort
    return [...rows].sort((a, b) => {
      const va = k(a)
      const vb = k(b)
      if (va === vb) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return (va < vb ? -1 : 1) * (sort!.dir === 'asc' ? 1 : -1)
    })
  }, [rows, columns, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize)
  if (rows.length === 0) return <Empty>{empty}</Empty>
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-panel-2 text-xs text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={clsx('whitespace-nowrap px-3 py-2 font-medium', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>
                  {c.sort ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-ink"
                      onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' }))}
                    >
                      {c.header}
                      {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={clsx('border-t border-line', onRowClick && 'cursor-pointer hover:bg-panel-2')}>
                {columns.map((c) => (
                  <td key={c.key} className={clsx('px-3 py-1.5', c.align === 'right' && 'num text-right', c.align === 'center' && 'text-center', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          Página {page + 1} de {pages} · {rows.length} filas
          <Button variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Siguiente
          </Button>
        </div>
      )}
    </div>
  )
}
