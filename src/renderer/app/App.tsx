import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { createHashRouter, NavLink, Outlet, RouterProvider } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ArrowLeftRight,
  Bell,
  BookOpen,
  Camera,
  ChartLine,
  Coins,
  Crosshair,
  Home,
  Plane,
  ScanText,
  Settings as SettingsIcon,
  ShoppingCart,
  Store,
  Wrench,
} from 'lucide-react'
import { platform } from '../platform'
import { useApi, useEvent } from '../lib/api'
import { Empty, Page } from '../components/ui'
import { OverviewPage } from '../features/overview/OverviewPage'
import { ToolsPage } from '../features/tools/ToolsPage'
import { CatalogPage } from '../features/catalog/CatalogPage'
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

interface NavItem {
  path: string
  label: string
  icon: typeof Home
  element: ComponentType
  desktopOnly?: boolean
}

const NAV: NavItem[] = [
  { path: '/', label: 'Inicio', icon: Home, element: OverviewPage },
  { path: '/tools', label: 'Herramientas', icon: Wrench, element: ToolsPage },
  { path: '/hunted', label: 'Hunted', icon: Crosshair, element: HuntedPage, desktopOnly: true },
  { path: '/catalog', label: 'Catálogo', icon: BookOpen, element: CatalogPage },
  { path: '/collector', label: 'Collector', icon: Camera, element: CollectorPage, desktopOnly: true },
  { path: '/ocr', label: 'Revisión OCR', icon: ScanText, element: OcrReviewPage, desktopOnly: true },
  { path: '/market', label: 'Market', icon: Store, element: MarketExplorerPage, desktopOnly: true },
  { path: '/history', label: 'Histórico', icon: ChartLine, element: PriceHistoryPage, desktopOnly: true },
  { path: '/tc', label: 'Tibia Coins', icon: Coins, element: TcMarketPage, desktopOnly: true },
  { path: '/arbitrage', label: 'Arbitraje', icon: ArrowLeftRight, element: ArbitragePage, desktopOnly: true },
  { path: '/transfers', label: 'Transferencias', icon: Plane, element: TransfersPage, desktopOnly: true },
  { path: '/cart', label: 'Carrito', icon: ShoppingCart, element: CartPage, desktopOnly: true },
  { path: '/alerts', label: 'Alertas', icon: Bell, element: AlertsPage, desktopOnly: true },
  { path: '/settings', label: 'Ajustes', icon: SettingsIcon, element: SettingsPage },
]

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
  const [watchOnline, setWatchOnline] = useState(0)
  const { data: unread = [] } = useApi('alerts.events.list', { unreadOnly: true, limit: 50 }, { enabled: platform.kind === 'electron', refetchInterval: 60_000 })
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
        setWatchOnline(p.online)
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
        setToast(p.count === 1 ? 'Captura de Tibia importada: revísala en Revisión OCR' : `${p.count} capturas de Tibia importadas`)
        void qc.invalidateQueries({ queryKey: ['collector.screenshots.list'] })
        void qc.invalidateQueries({ queryKey: ['collector.tibiaFolder.status'] })
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
        {NAV.filter((n) => platform.kind === 'electron' || !n.desktopOnly).map((n) => (
          <NavLink
            key={n.path}
            to={n.path}
            end={n.path === '/'}
            className={({ isActive }) => clsx('flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm', isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel-2 hover:text-ink')}
          >
            <n.icon className="size-4" aria-hidden />
            {n.label}
            {n.path === '/alerts' && unread.length > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">{unread.length}</span>}
            {n.path === '/hunted' && watchOnline > 0 && <span className="ml-auto rounded-full bg-bad px-1.5 text-[11px] font-semibold text-white" title="Vigilados conectados">{watchOnline}</span>}
          </NavLink>
        ))}
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
