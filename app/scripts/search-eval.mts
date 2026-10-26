// Corre el set de consultas de prueba contra Neon y muestra la interpretación y el top 5 de cada una, más las
// verificaciones de search-checks.ts (sale con error si alguna falla).
// Uso: yarn search:eval [--debug] [--top=10] [--f=open:today,diet:vegan] [--likes=<id>,<id>…] [consulta...]
//      yarn search:check   (sólo las consultas con verificaciones, sin el detalle)
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { memoryCache } from "../src/server/search/cache";
import { formatUsd } from "../src/server/search/cost";
import { runSearch } from "../src/server/search/search";
import { hasViewAll, visiblePage } from "../src/components/pages/SearchPage/utils/pagination";
import { neonPlacesStore } from "../src/server/search/store";
import { CHECKS, runChecks } from "./search-checks";

const QUERIES = [
  "la pasiva",
  "cardnal",
  "cafés en pocitos",
  "milanesa napolitana en parque rodo",
  "lugar tranquilo para trabajar",
  "vegano",
  "sin tacc",
  "abierto ahora",
  "brunch vegano con terraza en cordón el domingo",
  "algo que no sea pizza",
  "el mejor chivito",
  "best steak near Ciudad Vieja",
  "birra y picada",
  "cumpleaños para 15 personas",
  "sushi en el prado",
  "ceviche",
  "ceviche en pocitos",
  "bar con amigos",
  "pizza",
];

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const checkOnly = args.includes("--check");
// --f: los filtros de la barra, como el `f` de la URL.
const filters = args.find((arg) => arg.startsWith("--f="))?.slice("--f=".length) ?? null;
// --top: cuántos resultados mostrar de cada consulta (5 si no se pide).
const top = Number(args.find((arg) => arg.startsWith("--top="))?.slice("--top=".length)) || 5;
// --likes: ids de lugares como si te hubieran gustado (lo que manda la cookie), para ver los bloques personales.
const likes = args.find((arg) => arg.startsWith("--likes="))?.slice("--likes=".length).split(",").filter(Boolean) ?? [];
const queries = args.filter((arg) => !arg.startsWith("--"));

const store = neonPlacesStore(drizzle({ client: neon(process.env.DATABASE_URL!) }));
const cache = memoryCache();

const compact = (value: unknown) => JSON.stringify(value, (_key, item) => (Array.isArray(item) && item.length === 0 ? undefined : item));

const failures: string[] = [];
for (const query of queries.length ? queries : checkOnly ? Object.keys(CHECKS) : QUERIES) {
  const response = await runSearch(query, { store, cache }, { debug: true, filters, widen: !checkOnly, likes });
  const info = response.debug!;
  const checks = runChecks(query, response);
  failures.push(...checks.failed.map((failure) => `${query} → ${failure}`));
  if (checkOnly) {
    console.log(`${checks.failed.length ? "✗" : "✓"} ${query}`);
    for (const failure of checks.failed) console.log(`    ✗ ${failure}`);
    continue;
  }
  console.log(`\n━━ ${query}${filters ? `  (f=${filters})` : ""}${likes.length ? `  (${likes.length} likes)` : ""}  [${info.source}${info.model ? ` · ${info.model}` : ""} · ${info.timings.total} ms]`);
  if (info.llmError) console.log(`  error del modelo: ${info.llmError}`);
  const calls = info.cost.calls.map((call) => `${call.step} ${call.cached ? "cache" : call.usd === null ? "?" : formatUsd(call.usd)}`);
  console.log(`  costo: ${formatUsd(info.cost.totalUsd)}${calls.length ? ` (${calls.join(", ")})` : ""}`);
  console.log(`  interpretación: ${compact(info.interpretation)}`);
  if (info.discarded.length) console.log(`  descartado: ${info.discarded.map((entry) => `${entry.value} (${entry.reason})`).join(", ")}`);
  console.log(`  chips: ${response.interpreted.chips.map((chip) => `${chip.kind}:${chip.label}`).join(" | ") || "—"}`);
  for (const relaxed of response.relaxed) console.log(`  relajado (${relaxed.what}): ${relaxed.message}`);
  if (response.suggestedRemovals.length) console.log(`  para ampliar, sacá: ${response.suggestedRemovals.map((chip) => `${chip.kind}:${chip.id}`).join(", ")}`);
  if (response.needsLocation) console.log("  needsLocation: true");
  if (info.nameMatches[0]) {
    const best = info.nameMatches[0];
    console.log(`  nombre más parecido: ${best.name} (sim ${best.similarity.toFixed(2)}, word ${best.wordSimilarity.toFixed(2)})`);
  }
  // Por id: debug también trae las sucursales escondidas detrás de la card de su marca.
  const scoredById = new Map(info.results.map((entry) => [entry.id, entry]));
  response.results.slice(0, top).forEach((result, index) => {
    const scored = scoredById.get(result.id)!;
    const boosts = Object.entries(scored.boosts).map(([name, value]) => `${name}+${value}`).join(" ");
    console.log(
      `  ${index + 1}. ${result.name}${scored.pinned ? " 📌" : ""}${scored.featured ? " ⭐" : ""} [${result.matchLevel}] ${scored.score.toFixed(4)}${boosts ? ` (${boosts})` : ""} ×${scored.multiplier.toFixed(2)} (sin calidad: #${scored.positionWithoutQuality})`,
    );
    console.log(`     ${result.openStatus.label}${result.reasons.length ? ` · ${result.reasons.join(" · ")}` : ""}`);
  });
  for (const [position, result] of response.results.entries()) {
    if (result.branchCount < 2) continue;
    const hidden = info.results.filter((entry) => entry.collapsedInto === result.id).map((entry) => entry.name);
    console.log(`  marca ${scoredById.get(result.id)?.brandKey}: #${position + 1} ${result.name} · ${result.neighborhood} · ${result.id} (${result.branchCount} sucursales${hidden.length ? `; escondidas: ${hidden.length}` : ""})`);
  }
  if (response.results.length === 0) console.log("  (sin resultados)");
  else console.log(`  total: ${response.results.length}`);
  const sections = info.sections;
  const dropped = sections.dropped.length ? ` · descartados: ${sections.dropped.map((group) => `${group.id} (${group.count})`).join(", ")}` : "";
  const requested = sections.source ? ` · ${sections.source === "llm" ? "modelo" : "reglas"}: ${sections.requested.join(", ")}` : "";
  if (!response.sections) console.log(`  secciones: no (${sections.notGrouped})${requested}${dropped}`);
  else {
    console.log(`  secciones${requested}${dropped}`);
    const names = new Map(response.results.map((result) => [result.id, result.name]));
    for (const section of response.sections) console.log(`    ${section.title}: ${section.placeIds.map((id) => names.get(id)).join(", ")}`);
  }
  // Perfil: likes usados, el lugar de "Parecido a" y cada bloque personal con el parecido de sus lugares.
  const personal = info.personal;
  if (personal.skipped) console.log(`  perfil: no (${personal.skipped})`);
  else {
    console.log(`  perfil: ${personal.likes.map((like) => `${like.name} ${like.position === null ? "(no salió)" : `#${like.position}`}`).join(", ")}${personal.ignored.length ? ` · ignorados: ${personal.ignored.length}` : ""}`);
    if (personal.similarTo) {
      const { name, position, topCut, threshold } = personal.similarTo;
      console.log(`  parecido a: ${name} (#${position}) · top ${Math.round(personal.thresholds.similarTopShare * 100)} % desde ${topCut?.toFixed(3) ?? "—"} → umbral ${threshold.toFixed(3)}`);
    }
    for (const group of personal.groups) {
      const places = group.places.map((place) => `${place.name} ${place.similarity.toFixed(3)}`).join(", ");
      console.log(`    ${group.shown ? "✓" : "✗"} ${group.title}${group.reason ? ` (${group.reason})` : ""}${places ? `: ${places}` : ""}`);
    }
  }
  if (response.forYou) {
    const names = new Map(response.results.map((result) => [result.id, result.name]));
    console.log(`  ${response.forYou.title}: ${response.forYou.placeIds.map((id) => names.get(id)).join(", ")}`);
  }
  if (!checkOnly && response.results.length) {
    // Lo que ve la página de entrada (de a 12, grupos completos), los "Ver todos" y la invitación a ampliar.
    const page = visiblePage(response, 1);
    const shown = page.sections ? page.sections.map((section) => `${section.title} ${section.places.length}`).join(" · ") : `lista ${page.list?.length}`;
    console.log(`  de entrada: ${page.places.length} de ${response.results.length} (${shown})${page.hasMore ? " · con Ver más" : ""}`);
    for (const section of page.sections ?? []) {
      if (!hasViewAll(section)) continue;
      // La misma búsqueda con la regla del grupo (sin llamadas pagas: interpretación y embedding en cache).
      const all = await runSearch(query, { store, cache }, { filters: [filters, `section:${section.id}`].filter(Boolean).join(",") });
      console.log(`  Ver todos en ${section.title} (${section.total} en la regla) → muestra ${all.results.length}`);
    }
    const widen = response.widen ?? [];
    console.log(`  ampliar: ${widen.length ? widen.map((option) => `Sacá ${option.label} para ver ${option.count} más`).join(" | ") : "—"}`);
  }
  for (const passed of checks.passed) console.log(`  ✓ ${passed}`);
  for (const failure of checks.failed) console.log(`  ✗ ${failure}`);
  if (debug) {
    console.log(`  keywords: ${info.keywords.length ? info.keywords.join(", ") : "—"}`);
    for (const [name, entries] of Object.entries(info.rankings)) {
      if (entries.length) console.log(`  ranking ${name}: ${entries.slice(0, 5).map((entry) => `${entry.name} ${entry.score.toFixed(3)}`).join(", ")}`);
    }
    console.log(`  tiempos: ${compact(info.timings)}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} verificación(es) fallaron:\n${failures.map((failure) => `  ✗ ${failure}`).join("\n")}`);
  process.exit(1);
}
