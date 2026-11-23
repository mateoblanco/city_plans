import { useEffect, useState } from 'react'
import { generateGuideText, getGuideAiStatus, GuideGenerateError } from '@/lib/guides-api'
import type { GuideAiStatusResponse, GuideGenerateRequest, GuideGeneratedValue } from '@/types/guides'

/** Cómo quedó la última generación de un campo: el costo y, si falló, el error (con el link si es por crédito). */
export type AiSlot = { busy: boolean; cost: number | null; error: string | null; creditUrl: string | null; partial?: boolean }

const IDLE: AiSlot = { busy: false, cost: null, error: null, creditUrl: null }

/**
 * Estado de la IA en un editor: el crédito del Gateway (antes de generar), el estado de cada botón y el total gastado.
 * `run` pide el texto y lo entrega a `apply`; con un error no entrega nada. Lo generado nunca se guarda solo.
 */
export function useGuideAi(options: { initialTotal: number; onTotal?: (total: number) => void } = { initialTotal: 0 }) {
  const [status, setStatus] = useState<GuideAiStatusResponse | null>(null)
  const [slots, setSlots] = useState<Record<string, AiSlot>>({})
  const [total, setTotal] = useState(options.initialTotal)
  // Lo gastado mientras la guía no está guardada: se suma al crearla.
  const [pending, setPending] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getGuideAiStatus(controller.signal).then(setStatus).catch(() => {})
    return () => controller.abort()
  }, [])

  const noCredit = status?.balanceUsd === 0

  const account = (costUsd: number, guideCostUsd: number | null) => {
    if (guideCostUsd !== null) {
      setTotal(guideCostUsd)
      options.onTotal?.(guideCostUsd)
    } else if (costUsd > 0) {
      setTotal((current) => current + costUsd)
      setPending((current) => current + costUsd)
    }
  }

  async function run(key: string, request: GuideGenerateRequest, apply: (value: GuideGeneratedValue) => void) {
    setSlots((current) => ({ ...current, [key]: { ...IDLE, busy: true } }))
    try {
      const { value, costUsd, guideCostUsd } = await generateGuideText(request)
      account(costUsd, guideCostUsd)
      apply(value)
      // Generar los vacíos: los que salieron se cargan; los que fallaron se avisan (el costo es el de todos).
      const failed = value.kind === 'places-empty' ? value.errors.length : 0
      const errors = failed > 0 && value.kind === 'places-empty' ? `${failed === 1 ? '1 no se pudo generar' : `${failed} no se pudieron generar`}: ${value.errors[0].message}` : null
      setSlots((current) => ({ ...current, [key]: { busy: false, cost: costUsd, error: errors, creditUrl: null, partial: failed > 0 } }))
    } catch (error) {
      const failure = error instanceof GuideGenerateError ? error : new GuideGenerateError('UNKNOWN_ERROR', error instanceof Error ? error.message : 'No se pudo generar.')
      account(failure.costUsd, failure.guideCostUsd)
      if (failure.code === 'AI_NO_CREDIT') setStatus((current) => (current ? { ...current, balanceUsd: 0 } : current))
      setSlots((current) => ({ ...current, [key]: { busy: false, cost: failure.costUsd || null, error: failure.message, creditUrl: failure.creditUrl } }))
    }
  }

  return {
    status,
    noCredit,
    total,
    pending,
    /** Después de crear la guía: lo pendiente ya quedó sumado en la base. */
    clearPending: () => setPending(0),
    setTotal,
    slot: (key: string) => slots[key] ?? IDLE,
    run,
  }
}

export type GuideAi = ReturnType<typeof useGuideAi>
