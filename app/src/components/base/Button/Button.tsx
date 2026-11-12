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
} & (
        | { type: 'button'; onClick: () => void }
        | { type: 'submit' }
        // Navega: un <a> de Next con el estilo del botón (no un <button> dentro de un link).
        // external: un <a> común que abre en otra pestaña (Instagram, Google Maps).
        | { type?: undefined; href: string; prefetch?: boolean; external?: boolean }
    )

const Button = (props: Props) => {
    const buttonClass = clsx(
        styles.button,
        styles[`size-${props.size}`],
        styles[`variant-${props.variant}`],
        props.onlyIcon && styles["icon-button"],
    )
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
            {!props.onlyIcon && props.label}
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
