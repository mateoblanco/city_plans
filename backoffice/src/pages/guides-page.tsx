import { useState } from 'react'
import { GuideEditor } from '@/components/guide-editor'
import { GuideIntrosEditor } from '@/components/guide-intros-editor'
import { GuidesTable } from '@/components/guides-table'

type View = { tab: 'guides' } | { tab: 'intros' } | { tab: 'editor'; id: string | null; key: number }

/** Guías: el listado con el editor, y las introducciones de la ciudad y de cada barrio. Sin IA. */
export function GuidesPage() {
  const [view, setView] = useState<View>({ tab: 'guides' })
  const tab = view.tab === 'intros' ? 'intros' : 'guides'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <section aria-labelledby="guides-title">
        <div className="mb-6 max-w-2xl">
          <h2 id="guides-title" className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Guías</h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Listas de lugares elegidos a mano para /guides en la app. Lo que se publica aparece cuando vence la caché de la app (horas).
          </p>
        </div>

        <div role="tablist" aria-label="Secciones de guías" className="mb-5 inline-flex rounded-lg border bg-background p-1">
          {([['guides', 'Guías'], ['intros', 'Introducciones']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setView({ tab: id })}
            >
              {label}
            </button>
          ))}
        </div>

        {view.tab === 'guides' && (
          <GuidesTable onOpen={(id) => setView({ tab: 'editor', id, key: Date.now() })} onCreate={() => setView({ tab: 'editor', id: null, key: Date.now() })} />
        )}
        {view.tab === 'editor' && <GuideEditor key={view.key} guideId={view.id} onBack={() => setView({ tab: 'guides' })} />}
        {view.tab === 'intros' && <GuideIntrosEditor />}
      </section>
    </div>
  )
}
