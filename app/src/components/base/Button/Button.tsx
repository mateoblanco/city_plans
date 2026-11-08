import clsx from 'clsx';
import Link from 'next/link';
import styles from './Button.module.scss';
import { Button as ButtonBase } from '@base-ui/react/button';

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
    /** Botón que alterna (aria-pressed), p. ej. el me gusta. */
    pressed?: boolean;
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

    return (
        <ButtonBase
            disabled={props.disabled}
            type={isLink ? undefined : props.type}
            onClick={props.type === 'button' ? props.onClick : undefined}
            className={buttonClass}
            aria-label={props.onlyIcon ? props.label : undefined}
            aria-pressed={props.pressed}
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
}

export default Button;
