import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { createHashRouter, NavLink, Outlet, RouterProvider } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ArrowLeftRight,
  Bell,
  Camera,
  ChartLine,
  Coins,
  Crosshair,
  Globe2,
  Home,
  Plane,
  ScanText,
  Settings as SettingsIcon,
  Skull,
  ShoppingCart,
  Store,
  Wrench,
} from 'lucide-react'
import type { EventMap, ThirdPartySyncStatus } from '@shared/api'
import { platform } from '../platform'
import { useApi, useEvent } from '../lib/api'
import { Empty, Page } from '../components/ui'
import { OverviewPage } from '../features/overview/OverviewPage'
import { ToolsPage } from '../features/tools/ToolsPage'
import { WorldsPage } from '../features/worlds/WorldsPage'
import { CollectorPage } from '../features/collector/CollectorPage'
import { OcrReviewPage } from '../features/ocr-review/OcrReviewPage'
import { MarketExplorerPage } from '../features/market-explorer/MarketExplorerPage'
import { PriceHistoryPage } from '../features/price-history/PriceHistoryPage'
import { TcMarketPage } from '../features/tc-market/TcMarketPage'
import { ArbitragePage } from '../features/arbitrage/ArbitragePage'
import { TransfersPage } from '../features/transfers/TransfersPage'
import { CartPage } from '../features/cart/CartPage'
import { AlertsPage } from '../features/alerts/AlertsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { HuntedPage } from '../features/hunted/HuntedPage'
import { BossesPage } from '../features/bosses/BossesPage'

interface NavItem {
  path: string
  label: string
  icon: typeof Home
  element: ComponentType
  desktopOnly?: boolean
  /** Sección del menú; sin sección va arriba (Inicio) o abajo (Ajustes). */
  group?: string
}

// El menú sigue el flujo de uso: lo del día a día, el Market de un mundo y el comercio entre mundos.
const NAV: NavItem[] = [
  { path: '/', label: 'Inicio', icon: Home, element: OverviewPage },
  { path: '/hunted', label: 'Hunted', icon: Crosshair, element: HuntedPage, desktopOnly: true, group: 'Juego' },
  { path: '/bosses', label: 'Bosses', icon: Skull, element: BossesPage, desktopOnly: true, group: 'Juego' },
  { path: '/worlds', label: 'Mundos', icon: Globe2, element: WorldsPage, group: 'Juego' },
  { path: '/tools', label: 'Herramientas', icon: Wrench, element: ToolsPage, group: 'Juego' },
  { path: '/collector', label: 'Collector', icon: Camera, element: CollectorPage, desktopOnly: true, group: 'Market' },
  { path: '/ocr', label: 'Revisión OCR', icon: ScanText, element: OcrReviewPage, desktopOnly: true, group: 'Market' },
  { path: '/market', label: 'Market', icon: Store, element: MarketExplorerPage, desktopOnly: true, group: 'Market' },
  { path: '/history', label: 'Histórico', icon: ChartLine, element: PriceHistoryPage, desktopOnly: true, group: 'Market' },
  { path: '/tc', label: 'Tibia Coins', icon: Coins, element: TcMarketPage, desktopOnly: true, group: 'Market' },
  { path: '/arbitrage', label: 'Arbitraje', icon: ArrowLeftRight, element: ArbitragePage, desktopOnly: true, group: 'Entre mundos' },
  { path: '/transfers', label: 'Transferencias', icon: Plane, element: TransfersPage, desktopOnly: true, group: 'Entre mundos' },
  { path: '/cart', label: 'Carrito', icon: ShoppingCart, element: CartPage, desktopOnly: true, group: 'Entre mundos' },
  { path: '/alerts', label: 'Alertas', icon: Bell, element: AlertsPage, desktopOnly: true, group: 'Entre mundos' },
  { path: '/settings', label: 'Ajustes', icon: SettingsIcon, element: SettingsPage },
]

/** Contador del menú: solo visual (el nombre accesible del enlace no cambia). */
function NavBadge({ count, tone }: { count: number; tone: 'accent' | 'bad' }) {
  if (count <= 0) return null
  return (
    <span aria-hidden className={clsx('ml-auto rounded-full px-1.5 text-[11px] font-semibold', tone === 'bad' ? 'bg-bad text-white' : 'bg-accent text-accent-ink')}>
      {count}
    </span>
  )
}

function DesktopOnly({ label }: { label: string }) {
  return (
    <Page title={label}>
      <Empty>Esta sección necesita la app de escritorio (captura de pantalla y base de datos local).</Empty>
    </Page>
  )
}

function useTheme() {
  const { data: settings } = useApi('app.settings.get', undefined)
  useEffect(() => {
    const theme = settings?.theme ?? 'dark'
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])
}

function Layout() {
  useTheme()
  const qc = useQueryClient()
  const [toast, setToast] = useState<string | null>(null)
  const [urgent, setUrgent] = useState(false)
  const desktop = platform.kind === 'electron'
  const { data: unread = [] } = useApi('alerts.events.list', { unreadOnly: true, limit: 50 }, { enabled: desktop, refetchInterval: 60_000 })
  // Mismas consultas que Revisión OCR y Hunted: los contadores comparten su caché.
  const { data: shots = [] } = useApi('collector.screenshots.list', { status: null, limit: 100 }, { enabled: desktop })
  const { data: online = [] } = useApi('watch.online', undefined, { enabled: desktop })
  const badges: Record<string, { count: number; tone: 'accent' | 'bad'; title: string }> = {
    '/alerts': { count: unread.length, tone: 'accent', title: 'alertas sin leer' },
    '/hunted': { count: online.length, tone: 'bad', title: 'vigilados conectados' },
    '/ocr': { count: shots.filter((s) => s.status === 'new' || s.status === 'processed').length, tone: 'accent', title: 'capturas por revisar' },
  }
  const onAlerts = useCallback(
    (p: { count: number; messages: string[] }) => {
      setToast(p.messages[0] ?? `${p.count} alertas nuevas`)
      void qc.invalidateQueries({ queryKey: ['alerts.events.list'] })
    },
    [qc],
  )
  useEvent('alerts.fired', onAlerts)
  useEvent(
    'watch.update',
    useCallback(
      (p: { online: number; messages: string[]; burst: boolean }) => {
        for (const k of ['watch.status', 'watch.lists', 'watch.entries', 'watch.online', 'watch.events']) void qc.invalidateQueries({ queryKey: [k] })
        if (p.messages.length) {
          setUrgent(p.burst)
          setToast(p.messages.length === 1 ? p.messages[0]! : `${p.messages[0]} (+${p.messages.length - 1})`)
        }
      },
      [qc],
    ),
  )
  useEvent(
    'collector.imported',
    useCallback(
      (p: { count: number }) => {
        setToast(p.count === 1 ? 'Captura de Tibia importada: analizando…' : `${p.count} capturas de Tibia importadas: analizando…`)
        void qc.invalidateQueries({ queryKey: ['collector.screenshots.list'] })
        void qc.invalidateQueries({ queryKey: ['collector.tibiaFolder.status'] })
      },
      [qc],
    ),
  )
  // Resultado del análisis automático de cada captura del Market.
  useEvent(
    'collector.analyzed',
    useCallback(
      (p: EventMap['collector.analyzed']) => {
        if (p.decision === 'confirmed') setToast(`Guardado: ${p.item ?? 'item'}${p.world ? ` en ${p.world}` : ''}`)
        else if (p.decision === 'review') setToast(`Para revisar${p.item ? ` (${p.item})` : ''}: ${p.reasons[0] ?? 'revisa en Revisión OCR'}`)
        void qc.invalidateQueries({ queryKey: ['collector.screenshots.list'] })
        if (p.decision === 'confirmed') {
          for (const c of ['market.coverage', 'market.itemsWithData', 'market.scans.list', 'market.book', 'market.history', 'app.info']) void qc.invalidateQueries({ queryKey: [c] })
        }
      },
      [qc],
    ),
  )
  // Descarga de precios de terceros: el estado se refresca en cada mundo; los datos, cuando entra uno nuevo.
  const lastImported = useRef(-1)
  useEvent(
    'thirdParty.progress',
    useCallback(
      (s: ThirdPartySyncStatus) => {
        void qc.invalidateQueries({ queryKey: ['market.thirdParty.status'] })
        if (s.imported !== lastImported.current || !s.running) {
          lastImported.current = s.imported
          for (const k of ['market.itemsWithData', 'market.book', 'market.coverage', 'app.info']) void qc.invalidateQueries({ queryKey: [k] })
        }
        if (!s.running && s.finishedAt && s.imported > 0) setToast(`Precios de terceros: ${s.imported} mundos actualizados${s.failed ? `, ${s.failed} con error` : ''}`)
      },
      [qc],
    ),
  )
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => (setToast(null), setUrgent(false)), urgent ? 15_000 : 6_000)
    return () => clearTimeout(t)
  }, [toast, urgent])

  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav className="flex shrink-0 flex-row gap-0.5 overflow-x-auto border-b border-line bg-panel p-2 md:w-52 md:flex-col md:overflow-x-visible md:border-r md:border-b-0" aria-label="Secciones">
        <div className="mb-3 hidden items-center gap-2 px-2 pt-2 md:flex">
          <img src="./icon.png" alt="" className="size-7 rounded" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <div>
            <div className="text-sm font-semibold">Tibia Tools</div>
            <div className="text-[11px] text-muted">{platform.kind === 'web' ? 'companion web' : 'escritorio'}</div>
          </div>
        </div>
        {NAV.filter((n) => desktop || !n.desktopOnly).map((n, i, list) => {
          const header = n.group && n.group !== list[i - 1]?.group ? n.group : null
          const b = badges[n.path]
          return (
            <div key={n.path} className={clsx('contents md:block', n.path === '/settings' && 'md:mt-auto md:pt-2')}>
              {header && <div className="hidden px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted/70 uppercase md:block">{header}</div>}
              <NavLink
                to={n.path}
                end={n.path === '/'}
                title={b && b.count > 0 ? `${n.label}: ${b.count} ${b.title}` : undefined}
                className={({ isActive }) => clsx('flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm', isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel-2 hover:text-ink')}
              >
                <n.icon className="size-4" aria-hidden />
                {n.label}
                {b && <NavBadge count={b.count} tone={b.tone} />}
              </NavLink>
            </div>
          )
        })}
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
      {toast && (
        <div role="status" className={clsx('fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-panel px-4 py-3 text-sm shadow-xl', urgent ? 'border-bad bg-bad/15 font-semibold' : 'border-accent/50')}>
          <Bell className={clsx('mr-2 inline size-4', urgent ? 'text-bad' : 'text-accent')} aria-hidden />
          {toast}
        </div>
      )}
    </div>
  )
}

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: NAV.map((n) => {
      const El = n.desktopOnly && platform.kind === 'web' ? () => <DesktopOnly label={n.label} /> : n.element
      return n.path === '/' ? { index: true, element: <El /> } : { path: n.path.slice(1), element: <El /> }
    }),
  },
])

export function App() {
  return <RouterProvider router={router} />
}
