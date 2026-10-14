import { useEffect, useState } from 'react'
import { Database, Map as MapIcon, Search, Utensils } from 'lucide-react'
import { NeighborhoodSweepPage } from '@/pages/neighborhood-sweep-page'
import { PlaceSearchPage } from '@/pages/place-search-page'
import { SavedPlacesPage } from '@/pages/saved-places-page'

type PageId = 'search' | 'neighborhood' | 'places'

const pages: readonly { id: PageId; hash: string; label: string; icon: typeof Search }[] = [
  { id: 'search', hash: '#/', label: 'Buscar lugares', icon: Search },
  { id: 'neighborhood', hash: '#/barrio', label: 'Buscar por barrio', icon: MapIcon },
  { id: 'places', hash: '#/lugares', label: 'Lugares', icon: Database },
]

function pageFromHash(hash: string): PageId {
  if (hash === '#/barrio') return 'neighborhood'
  if (hash === '#/lugares') return 'places'
  return 'search'
}

function App() {
  const [page, setPage] = useState<PageId>(() => pageFromHash(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div className="min-h-svh bg-[#f7f7f5] text-foreground md:flex">
      <aside className="border-b border-border/80 bg-background md:sticky md:top-0 md:h-svh md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-3 px-4 py-5 sm:px-6 md:px-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
            <Utensils className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Montevideo
            </p>
            <h1 className="text-lg font-semibold tracking-tight">City Plans Backoffice</h1>
          </div>
        </div>
        <nav aria-label="Secciones" className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-6 md:flex-col md:px-3">
          {pages.map((item) => {
            const Icon = item.icon
            const active = item.id === page
            return (
              <a
                key={item.id}
                href={item.hash}
                onClick={() => setPage(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </a>
            )
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        {page === 'search' && <PlaceSearchPage />}
        {page === 'neighborhood' && <NeighborhoodSweepPage />}
        {page === 'places' && <SavedPlacesPage />}
      </main>
    </div>
  )
}

export default App
