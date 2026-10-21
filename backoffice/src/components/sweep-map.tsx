import { useEffect, useRef } from 'react'
import { AdvancedMarker, AdvancedMarkerAnchorPoint, APIProvider, Map, useMap } from '@vis.gl/react-google-maps'

const MONTEVIDEO = { lat: -34.9011, lng: -56.1645 }

export type SweepMapStatus = 'new' | 'saved' | 'review' | 'rejected'

export type SweepMapPoint = {
  placeId: string
  name: string
  lat: number
  lng: number
  status: SweepMapStatus
  selected: boolean
  /** Misma regla que el checkbox de la lista. */
  selectable: boolean
  /** De otra tab de grupo: se ve, pero atenuado. */
  dimmed: boolean
}

const STATUS_STYLES: Record<SweepMapStatus, { label: string; dot: string }> = {
  new: { label: 'Nuevo', dot: 'bg-emerald-600' },
  saved: { label: 'Ya guardado', dot: 'bg-sky-600' },
  review: { label: 'A revisar', dot: 'bg-amber-500' },
  rejected: { label: 'Rechazado', dot: 'bg-red-600' },
}

type FitBoundsProps = {
  points: readonly SweepMapPoint[]
  fitKey: string
}

/** Encuadra los puntos una vez por cada fitKey, para no mover el mapa con cada evento del barrido. */
function FitBounds({ points, fitKey }: FitBoundsProps) {
  const map = useMap()
  const fitted = useRef<string | null>(null)

  useEffect(() => {
    if (!map || points.length === 0 || fitted.current === fitKey) return
    fitted.current = fitKey
    if (points.length === 1) {
      map.setCenter(points[0])
      map.setZoom(16)
      return
    }
    const lats = points.map((point) => point.lat)
    const lngs = points.map((point) => point.lng)
    map.fitBounds({ north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) }, 32)
  }, [map, points, fitKey])

  return null
}

type SweepMapProps = {
  points: readonly SweepMapPoint[]
  fitKey: string
  highlightedId: string | null
  onHover: (placeId: string | null) => void
  onToggle: (placeId: string) => void
}

export function SweepMap({ points, fitKey, highlightedId, onHover, onToggle }: SweepMapProps) {
  // Clave de navegador propia, restringida a Maps JavaScript API: no es GOOGLE_PLACES_API_KEY, que sigue sólo en el servidor.
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined
  // Los AdvancedMarker necesitan un Map ID; sin uno propio, el de demo de Google.
  const mapId = (import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined) || 'DEMO_MAP_ID'
  if (!apiKey) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center rounded-xl bg-muted/30 px-6 text-center text-sm text-muted-foreground">
        Mapa no disponible: falta VITE_GOOGLE_MAPS_BROWSER_KEY.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border">
        <APIProvider apiKey={apiKey} language="es" region="UY">
          <Map
            className="size-full"
            mapId={mapId}
            defaultCenter={MONTEVIDEO}
            defaultZoom={14}
            disableDefaultUI
            zoomControl
            clickableIcons={false}
            gestureHandling="greedy"
          >
            {points.map((point) => {
              const active = point.placeId === highlightedId
              const style = STATUS_STYLES[point.status]
              return (
                <AdvancedMarker
                  key={point.placeId}
                  position={point}
                  title={point.name}
                  anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                  zIndex={active ? 3 : point.selected ? 2 : point.dimmed ? 0 : 1}
                  clickable
                  onClick={() => {
                    if (point.selectable) onToggle(point.placeId)
                  }}
                  onMouseEnter={() => onHover(point.placeId)}
                  onMouseLeave={() => onHover(null)}
                >
                  <div className={`relative ${point.selectable ? 'cursor-pointer' : 'cursor-default'}`}>
                    <div
                      className={`rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)] transition-transform ${style.dot} ${
                        point.selected ? 'size-3.5 ring-2 ring-foreground' : 'size-2.5'
                      } ${active ? 'scale-150' : ''} ${point.dimmed && !active ? 'opacity-40' : ''}`}
                    />
                    {active && (
                      <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow">
                        {point.name}
                      </span>
                    )}
                  </div>
                </AdvancedMarker>
              )
            })}
            <FitBounds points={points} fitKey={fitKey} />
          </Map>
        </APIProvider>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Referencias del mapa">
        {(Object.keys(STATUS_STYLES) as SweepMapStatus[]).map((status) => (
          <li key={status} className="inline-flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${STATUS_STYLES[status].dot}`} aria-hidden="true" />
            {STATUS_STYLES[status].label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full ring-2 ring-foreground" aria-hidden="true" />
          Seleccionado
        </li>
      </ul>
    </div>
  )
}
