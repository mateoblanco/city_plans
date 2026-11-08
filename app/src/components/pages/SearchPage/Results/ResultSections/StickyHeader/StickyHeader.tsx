"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  className: string;
  children: React.ReactNode;
};

/**
 * Header de sección sticky que marca data-stuck mientras está pegado (sin eso, el borde inferior no se ve). Pegado =
 * su borde de arriba llegó al `top` del sticky; antes de eso está en su lugar, más abajo. En desktop scrollea la
 * página; en mobile, el panel de resultados (Drawer.Content): el `top` se mide desde el borde de ese contenedor.
 */
const StickyHeader = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const stickyTop = parseFloat(getComputedStyle(element).top) || 0;
      const containerTop = element.closest("[data-drawer-content]")?.getBoundingClientRect().top ?? 0;
      setStuck(element.getBoundingClientRect().top <= containerTop + stickyTop + 0.5);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    // En captura: también llega el scroll del panel, que no burbujea.
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={props.className} data-stuck={stuck || undefined}>
      {props.children}
    </div>
  );
};

export default StickyHeader;
