import { activeDiscountProviders } from "@/server/discounts";
import WelcomeGate from "./WelcomeGate/WelcomeGate";

/**
 * Bienvenida de la home (primera visita): trae los proveedores del paso de tarjetas (cacheados, los mismos del panel de
 * Descuentos) y deja que el cliente decida si se muestra. El diálogo nunca va en el HTML del servidor.
 */
const HomeWelcome = async () => {
  const providers = await activeDiscountProviders().catch(() => []);
  return <WelcomeGate providers={providers} />;
};

export default HomeWelcome;
