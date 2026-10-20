import { groupOf, label, type GroupName } from '@/data/tags'
import type { PlaceEnrichmentDraft } from '@/types/places'

const GROUPS: { group: GroupName; title: string }[] = [
  { group: 'categories', title: 'Categorías' },
  { group: 'moments', title: 'Momentos' },
  { group: 'cuisines', title: 'Cocinas' },
  { group: 'foods', title: 'Comidas' },
  { group: 'drinks', title: 'Bebidas' },
  { group: 'features', title: 'Características' },
  { group: 'atmosphere', title: 'Ambiente' },
  { group: 'goodFor', title: 'Ideal para' },
  { group: 'offers', title: 'Ofertas' },
  { group: 'style', title: 'Estilo' },
]

// De dónde salió el style.
const STYLE_BASIS = { signals: 'señales', price: 'precio', icon: 'ícono' } as const

type PlaceTagsEvidenceProps = {
  place: Pick<PlaceEnrichmentDraft, 'categories' | 'tags' | 'placeFacts' | 'style' | 'tagEvidence'>
}

/** Muestra cada categoría y tag del borrador con los facts que lo respaldan. */
export function PlaceTagsEvidence({ place }: PlaceTagsEvidenceProps) {
  const ids = [...place.categories, ...place.tags]
  const sections = GROUPS
    .map(({ group, title }) => ({
      group,
      title,
      // categories va aparte: un id de tag nunca se agrupa como categoría.
      ids: group === 'categories' ? place.categories
        : group === 'style' ? (place.style ? [place.style] : [])
        : place.tags.filter((id) => groupOf(id) === group),
    }))
    .filter((section) => section.ids.length > 0)

  if (ids.length === 0) return null

  return (
    <section aria-label="Tags y su respaldo" className="space-y-3 rounded-xl border p-4 text-sm">
      <h3 className="font-medium">Tags y su respaldo</h3>
      {sections.map((section) => (
        <div key={section.group} className="space-y-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.title}</h4>
          <ul className="space-y-1.5">
            {section.ids.map((id) => {
              const facts = place.placeFacts.filter((fact) => fact.supports.includes(`${section.group}.${id}`))
              const evidence = place.tagEvidence?.find((item) => item.tag === id)
              return (
                <li key={id}>
                  <span className="font-medium">{label(id, 'es')}</span>{' '}
                  <code className="text-xs text-muted-foreground">{id}</code>
                  {evidence && (
                    <span className="text-xs text-muted-foreground">
                      {' '}· {evidence.mode === 'explicit' ? 'Explícito' : 'Inferido'}{evidence.basis ? ` por ${STYLE_BASIS[evidence.basis]}` : ''}{evidence.signals.length > 0 ? `: ${evidence.signals.join(', ')}` : ''}
                    </span>
                  )}
                  {facts.length > 0 ? (
                    <ul className="mt-0.5 space-y-0.5 pl-4 text-muted-foreground">
                      {facts.map((fact) => (
                        <li key={fact.id}>
                          <span className="font-mono text-xs">{fact.id}</span> · {fact.text}{' '}
                          <span className="text-xs">({fact.trust === 'official' ? 'Oficial' : 'Terceros'})</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pl-4 text-xs text-muted-foreground">Agregado por regla (categoría u horarios)</p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
