"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Button from "@/components/base/Button/Button";
import Dialog from "@/components/base/Dialog/Dialog";
import DiscountChoices from "@/components/DiscountChoices/DiscountChoices";
import type { DiscountProvider } from "@/components/DiscountChoices/utils/options";
import { readMyCards, setMyCards } from "@/components/pages/SearchPage/utils/my-cards";
import { addSaved } from "@/components/pages/SearchPage/utils/saved";
import { markWelcomeDone } from "../utils/welcome";
import WelcomePlaces from "./WelcomePlaces/WelcomePlaces";
import styles from "./WelcomeDialog.module.scss";

type Props = {
  providers: DiscountProvider[];
};

const STEPS = {
  cards: { title: "¿Qué tarjetas tenés?", description: "Te mostramos los descuentos que podés usar." },
  places: { title: "Elegí hasta 3 lugares que te gusten", description: "Así te recomendamos lugares para vos." },
} as const;

type Step = keyof typeof STEPS;

/**
 * Bienvenida de la home en dos pasos: tus tarjetas (las filas del panel de Descuentos) y hasta 3 lugares que te gustan.
 * Las tarjetas pasan a ser mis tarjetas; los lugares van a guardados (el corazón), con la fecha. Escape, el fondo o
 * "Saltear" en el último paso la cierran; terminada o salteada no vuelve. Si se guardó algo, la home se actualiza con
 * las filas nuevas ("Guardados", "Para vos", "Descuentos con <Banco>"). Sin proveedores, sólo el paso de lugares.
 */
const WelcomeDialog = (props: Props) => {
  const router = useRouter();
  const steps: Step[] = props.providers.length > 0 ? ["cards", "places"] : ["places"];
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState<Step>(steps[0]);
  const [cards, setCards] = useState<string[]>(() => readMyCards());
  const [places, setPlaces] = useState<string[]>([]);
  /** Si ya se guardaron tarjetas (en el paso 1): al cerrar, la home se actualiza aunque se saltee el resto. */
  const savedCards = useRef(false);
  const index = steps.indexOf(step);

  const finish = (refresh: boolean) => {
    markWelcomeDone();
    setOpen(false);
    if (refresh) router.refresh();
  };

  const next = () => {
    if (cards.length > 0) savedCards.current = setMyCards(cards);
    setStep("places");
  };

  const done = () => {
    const saved = places.length > 0 && addSaved(places);
    finish(saved || savedCards.current);
  };

  const footer =
    step === "cards" ? (
      <>
        <Button type="button" variant="tertiary" size="md" label="Saltear" onClick={() => setStep("places")} />
        <Button type="button" variant="primary" size="md" label="Siguiente" onClick={next} />
      </>
    ) : (
      <>
        <Button type="button" variant="tertiary" size="md" label="Saltear" onClick={() => finish(savedCards.current)} />
        <Button type="button" variant="primary" size="md" label="Listo" onClick={done} />
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(savedCards.current);
      }}
      title={STEPS[step].title}
      description={steps.length > 1 ? `Paso ${index + 1} de ${steps.length} · ${STEPS[step].description}` : STEPS[step].description}
      step={step}
      footer={footer}
    >
      {step === "cards" ? (
        <div className={styles.cards}>
          <DiscountChoices providers={props.providers} selected={cards} onChange={setCards} />
        </div>
      ) : (
        <WelcomePlaces selected={places} onChange={setPlaces} />
      )}
    </Dialog>
  );
};

export default WelcomeDialog;
