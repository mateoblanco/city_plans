import { label } from "@shared/tags.ts";
import type { SearchResult } from "@/server/search";
import type { KeptBy } from "@/server/search/relevance";

/** Sólo con ?debug=1: puntajes, similitud semántica con la consulta y por qué pasó el corte por relevancia. */
export type CardDebug = { score: number; baseScore: number; multiplier: number; similarity: number | null; keptBy: KeptBy | null; pinned: boolean };

const KEPT_LABELS: Record<KeptBy, string> = {
  pinned: "por nombre",
  category: "por categoría",
  tag: "por tag",
  dish: "por plato",
  keyword: "por keyword",
  similar: "por similitud",
  "no-similarity": "sin similitud",
};

type PlaceCardProps = {
  place: SearchResult;
  debug?: CardDebug;
};

const number = (value: number) => value.toLocaleString("es-UY", { maximumSignificantDigits: 3 });

const debugLine = ({ score, baseScore, multiplier, similarity, keptBy, pinned }: CardDebug) =>
  [
    `puntaje ${number(score)}`,
    `relevancia ${number(baseScore)}`,
    `×${multiplier.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    similarity === null ? null : `sim ${similarity.toLocaleString("es-UY", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`,
    keptBy && keptBy !== "pinned" ? KEPT_LABELS[keptBy] : null,
    pinned ? "fijado" : null,
  ]
    .filter(Boolean)
    .join(" · ");

const PlaceCard = ({ place, debug }: PlaceCardProps) => {
  // Los motivos ya incluyen el barrio y el horario, que acá tienen su propia línea.
  const reasons = place.reasons.filter((reason) => reason !== place.neighborhood && reason !== place.openStatus.label);

  return (
    <article style={{ border: "1px solid black", display: "flex", flexDirection: "column", gap: 6, padding: 12 }}>
      <h3 style={{ fontSize: 16 }}>{place.name}</h3>
      <p style={{ fontSize: 14 }}>
        {[place.neighborhood, ...place.categories.map((id) => label(id, "es"))].join(" · ")}
      </p>
      <p style={{ fontSize: 14, color: place.openStatus.state === "open" ? "#1a7f37" : "#555555" }}>{place.openStatus.label}</p>
      {reasons.length > 0 && (
        <ul style={{ fontSize: 13, color: "#555555", paddingLeft: 16 }}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {debug && <p style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, color: "#555555" }}>{debugLine(debug)}</p>}
    </article>
  );
};

export default PlaceCard;
