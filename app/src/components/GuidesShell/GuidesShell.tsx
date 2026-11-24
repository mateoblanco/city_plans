import { Suspense, type ReactNode } from "react";
import Footer from "@/components/Footer/Footer";
import Header from "@/components/Header/Header";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import SkipLinks from "@/components/SkipLinks/SkipLinks";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";

type Props = {
  /** Lo que lee los params (dentro del Suspense: con cacheComponents son datos del pedido). */
  children: ReactNode;
};

/** El marco de las páginas de guías (ciudad, barrio y guía): saltos, header con volver, el <main> y el footer. */
const GuidesShell = (props: Props) => (
  <>
    <SkipLinks links={[{ target: SKIP_TARGETS.content, label: "Ir al contenido" }]} />
    <Header compactBelow="md">
      <HeaderBack below="md" />
    </Header>
    <main id={SKIP_TARGETS.content} data-skip-target>
      <Suspense fallback={null}>{props.children}</Suspense>
    </main>
    <Footer />
  </>
);

export default GuidesShell;
