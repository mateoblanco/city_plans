"use client";

import styles from "./SkipLinks.module.scss";

type Props = {
  links: {
    /** Id del destino (SKIP_TARGETS). */
    target: string;
    label: string;
    /** Si el destino no está en la página (p. ej. una búsqueda que falló, sin lista), va a este. */
    fallback?: string;
    /** Sólo desde md (p. ej. "Ir al mapa": en mobile el mapa queda detrás del panel). */
    desktopOnly?: boolean;
  }[];
};

/**
 * Links para saltar (WCAG 2.4.1): lo primero que se enfoca con Tab. No se ven hasta que reciben el foco. Mueven el foco
 * al destino (no sólo el scroll) sin tocar la URL: un #hash en /search sumaría una entrada al historial.
 */
const SkipLinks = (props: Props) => (
  <nav className={styles.skipLinks} aria-label="Saltar a">
    {props.links.map((link) => (
      <a
        key={link.target}
        className={styles.link}
        data-desktop-only={link.desktopOnly || undefined}
        href={`#${link.target}`}
        onClick={(event) => {
          const target = document.getElementById(link.target) ?? (link.fallback ? document.getElementById(link.fallback) : null);
          if (!target) return;
          event.preventDefault();
          // tabIndex sólo al saltar: fijo en el <main>, cualquier click adentro lo enfocaría.
          if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
          target.focus();
        }}
      >
        {link.label}
      </a>
    ))}
  </nav>
);

export default SkipLinks;
