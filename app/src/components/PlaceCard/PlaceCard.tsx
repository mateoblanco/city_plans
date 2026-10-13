import { label } from "@shared/tags.ts";
import type { SearchResult } from "@/server/search";

type PlaceCardProps = {
  place: SearchResult;
};

const PlaceCard = ({ place }: PlaceCardProps) => {
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
    </article>
  );
};

export default PlaceCard;
