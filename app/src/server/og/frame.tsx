import type { ReactNode } from 'react'
import { OG_COLORS, OG_LAYOUT, OG_SIZE } from './model'

type FrameProps = {
  bandColor: string
  boxColor: string
  borderColor: string
  children: ReactNode
}

/**
 * Fondo blanco, la banda arriba a todo el ancho y el recuadro centrado (horizontal y vertical) que pisa la banda y el
 * blanco: borde de 20, radio 50 afuera (30 adentro) y una sombra suave hacia abajo. Estilos en línea: es Satori, no la app.
 */
export const OgFrame = (props: FrameProps) => (
  <div style={{ display: 'flex', position: 'relative', width: OG_SIZE.width, height: OG_SIZE.height, backgroundColor: OG_COLORS.surface }}>
    <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: OG_SIZE.width, height: OG_LAYOUT.bandHeight, backgroundColor: props.bandColor }} />
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        top: (OG_SIZE.height - OG_LAYOUT.box) / 2,
        left: (OG_SIZE.width - OG_LAYOUT.box) / 2,
        width: OG_LAYOUT.box,
        height: OG_LAYOUT.box,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: props.boxColor,
        border: `${OG_LAYOUT.border}px solid ${props.borderColor}`,
        borderRadius: OG_LAYOUT.radius,
        boxShadow: '0 16px 32px rgba(0, 0, 0, 0.12)',
      }}
    >
      {props.children}
    </div>
  </div>
)

type NameProps = { fontSize: number; lines: string[]; fontFamily: string | undefined }

/** El nombre del lugar sin logo: una línea por elemento (fitName ya las cortó), centrado. */
export const OgName = (props: NameProps) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: OG_LAYOUT.nameWidth, color: OG_COLORS.text, fontFamily: props.fontFamily, fontWeight: 600, fontSize: props.fontSize, lineHeight: 1.2, textAlign: 'center' }}>
    {props.lines.map((line, index) => (
      <div key={index} style={{ display: 'flex', whiteSpace: 'nowrap' }}>{line}</div>
    ))}
  </div>
)
