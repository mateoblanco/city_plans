// Corre el set de consultas de prueba contra Neon y muestra la interpretación y el top 5 de cada una.
// Uso: yarn search:eval [--debug] [consulta...]
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { memoryCache } from "../src/server/search/cache";
import { runSearch } from "../src/server/search/search";
import { neonPlacesStore } from "../src/server/search/store";

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
];

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const queries = args.filter((arg) => !arg.startsWith("--"));

const store = neonPlacesStore(drizzle({ client: neon(process.env.DATABASE_URL!) }));
const cache = memoryCache();

const compact = (value: unknown) => JSON.stringify(value, (_key, item) => (Array.isArray(item) && item.length === 0 ? undefined : item));

for (const query of queries.length ? queries : QUERIES) {
  const response = await runSearch(query, { store, cache }, { debug: true });
  const info = response.debug!;
  console.log(`\n━━ ${query}  [${info.source}${info.model ? ` · ${info.model}` : ""} · ${info.timings.total} ms]`);
  if (info.llmError) console.log(`  error del modelo: ${info.llmError}`);
  console.log(`  interpretación: ${compact(info.interpretation)}`);
  if (info.discarded.length) console.log(`  descartado: ${info.discarded.join(", ")}`);
  console.log(`  chips: ${response.interpreted.chips.map((chip) => `${chip.kind}:${chip.label}`).join(" | ") || "—"}`);
  for (const relaxed of response.relaxed) console.log(`  relajado (${relaxed.what}): ${relaxed.message}`);
  if (response.suggestedRemovals.length) console.log(`  para ampliar, sacá: ${response.suggestedRemovals.map((chip) => `${chip.kind}:${chip.id}`).join(", ")}`);
  if (response.needsLocation) console.log("  needsLocation: true");
  if (info.nameMatches[0]) {
    const best = info.nameMatches[0];
    console.log(`  nombre más parecido: ${best.name} (sim ${best.similarity.toFixed(2)}, word ${best.wordSimilarity.toFixed(2)})`);
  }
  response.results.slice(0, 5).forEach((result, index) => {
    const scored = info.results[index];
    const boosts = Object.entries(scored.boosts).map(([name, value]) => `${name}+${value}`).join(" ");
    console.log(
      `  ${index + 1}. ${result.name}${scored.pinned ? " 📌" : ""}${scored.featured ? " ⭐" : ""} [${result.matchLevel}] ${scored.score.toFixed(4)}${boosts ? ` (${boosts})` : ""} ×${scored.multiplier.toFixed(2)} (sin calidad: #${scored.positionWithoutQuality})`,
    );
    console.log(`     ${result.reasons.join(" · ")}`);
  });
  if (response.results.length === 0) console.log("  (sin resultados)");
  if (debug) {
    for (const [name, entries] of Object.entries(info.rankings)) {
      if (entries.length) console.log(`  ranking ${name}: ${entries.slice(0, 5).map((entry) => `${entry.name} ${entry.score.toFixed(3)}`).join(", ")}`);
    }
    console.log(`  tiempos: ${compact(info.timings)}`);
  }
}
