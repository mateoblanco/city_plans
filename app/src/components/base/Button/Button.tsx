import clsx from 'clsx';
import Link from 'next/link';
import styles from './Button.module.scss';
import { Button as ButtonBase } from '@base-ui/react/button';
import { Tooltip as TooltipBase } from '@base-ui/react/tooltip';
import tooltipStyles from '../Tooltip/Tooltip.module.scss';

type Props = {
    /** Texto del botón; con onlyIcon pasa a ser su nombre accesible (aria-label). */
    label: string;
    disabled?: boolean;
    /** ghost: sin fondo ni padding (p. ej. la flecha de volver del header de /search). */
    variant: 'primary' | 'secondary' | 'tertiary' | 'ghost';
    size: 'sm' | 'md';
    icon?: React.ReactNode;
    /** Ícono después del texto (p. ej. la flecha de un link externo); no se muestra con onlyIcon. */
    iconEnd?: React.ReactNode;
    onlyIcon?: boolean;
    /** Botón que alterna (aria-pressed), p. ej. el corazón de guardar de la card. */
    pressed?: boolean;
    /**
     * Tooltip visual al pasar el mouse o con foco (p. ej. "Guardar" / "Guardado"). Es sólo para la vista: el nombre
     * accesible sigue siendo label (y el estado, aria-pressed). Sólo en botones (no en links).
     */
    tooltip?: string;
    /** Botón que muestra u oculta otra parte (aria-expanded), con el id de esa parte (aria-controls). */
    expanded?: boolean;
    controls?: string;
    /**
     * Área táctil de al menos 44×44 sin cambiar cómo se ve (un ::after invisible centrado). Opcional: hoy la usan las
     * partes de guías ("Ver mapa", cerrar el mapa, el corazón de cada lugar).
     */
    touchTarget?: boolean;
    /**
     * Sólo el ícono debajo de ese breakpoint (p. ej. "Compartir" en la ficha mobile); desde ahí, ícono y texto. El texto
     * queda oculto a la vista pero sigue siendo el nombre accesible.
     */
    iconOnlyBelow?: 'ml';
} & (
        | { type: 'button'; onClick: () => void }
        | { type: 'submit' }
        // Navega: un <a> de Next con el estilo del botón (no un <button> dentro de un link).
        // external: un <a> común que abre en otra pestaña (Instagram, Google Maps).
        | { type?: undefined; href: string; prefetch?: boolean; external?: boolean }
    )

/**
 * Las clases del botón, para darle su estilo a un botón de Base UI que no puede ser este componente (p. ej. el
 * Menu.Trigger de "Compartir" en la ficha).
 */
export const buttonClassName = (props: Pick<Props, 'variant' | 'size' | 'onlyIcon' | 'touchTarget' | 'iconOnlyBelow'>) => clsx(
    styles.button,
    styles[`size-${props.size}`],
    styles[`variant-${props.variant}`],
    props.onlyIcon && styles["icon-button"],
    props.touchTarget && styles["touch-target"],
    props.iconOnlyBelow && styles[`icon-only-below-${props.iconOnlyBelow}`],
)

/** El texto de un botón con iconOnlyBelow (lo que se oculta debajo del breakpoint), para un trigger de Base UI. */
export const buttonLabelClassName = styles.label;

const Button = (props: Props) => {
    const buttonClass = buttonClassName(props)
    const isLink = 'href' in props;

    const button = (
        <ButtonBase
            disabled={props.disabled}
            type={isLink ? undefined : props.type}
            onClick={props.type === 'button' ? props.onClick : undefined}
            className={buttonClass}
            aria-label={props.onlyIcon ? props.label : undefined}
            aria-pressed={props.pressed}
            aria-expanded={props.expanded}
            aria-controls={props.controls}
            nativeButton={!isLink}
            render={!isLink ? undefined
                : props.external ? <a href={props.href} target="_blank" rel="noopener noreferrer" />
                : <Link href={props.href} prefetch={props.prefetch} />}
        >
            {props.icon && props.icon}
            {!props.onlyIcon && (props.iconOnlyBelow ? <span className={styles.label}>{props.label}</span> : props.label)}
            {!props.onlyIcon && props.iconEnd}
        </ButtonBase>
    );
    if (!props.tooltip || isLink) return button;

    // El Trigger es el mismo botón (render): no agrega otro elemento enfocable.
    return (
        <TooltipBase.Root>
            <TooltipBase.Trigger render={button} delay={300} />
            <TooltipBase.Portal>
                <TooltipBase.Positioner className={tooltipStyles.positioner} sideOffset={6}>
                    <TooltipBase.Popup className={tooltipStyles.popup} aria-hidden>{props.tooltip}</TooltipBase.Popup>
                </TooltipBase.Positioner>
            </TooltipBase.Portal>
        </TooltipBase.Root>
    );
}

export default Button;
