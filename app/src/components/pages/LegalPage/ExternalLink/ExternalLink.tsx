import type { ReactNode } from "react";

type Props = {
  href: string;
  children: ReactNode;
};

/** Link a otro sitio dentro del texto legal: en otra pestaña. El estilo es el de los links del texto (LegalPage .content). */
const ExternalLink = (props: Props) => (
  <a href={props.href} target="_blank" rel="noopener noreferrer">
    {props.children}
  </a>
);

export default ExternalLink;
