import { redirect } from "next/navigation";
import { GUIDES_HOME_TARGET } from "@/server/guides/routes";

// /guides todavía no es una página: el proxy redirige (307) a la ciudad antes de llegar acá. Esto es el respaldo.
export default function Guides() {
  redirect(GUIDES_HOME_TARGET);
}
