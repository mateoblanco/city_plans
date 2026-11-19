import { INTENTS } from '@shared/intents.ts'
import type { GuideGroup } from './types'

/** "Comer", "Tomar algo", "Cafés", "Postres": la etiqueta de la intención. Aparte de catalog.ts, que usa el proxy. */
export const groupLabel = (group: GuideGroup) => INTENTS[group].label.es
