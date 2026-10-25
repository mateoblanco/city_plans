declare module "*.svg" {
  import type { FC, SVGProps } from "react";

  const ReactComponent: FC<SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

// Los íconos de los marcadores no pasan por svgr (next.config.ts): son imágenes estáticas con URL.
declare module "@shared/icons/*.svg" {
  import type { StaticImageData } from "next/image";

  const icon: StaticImageData;
  export default icon;
}
