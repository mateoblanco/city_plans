/** Colores del chip de una línea de ómnibus: fondo y texto, según la empresa (o el grupo dentro de la empresa). */
export type LinePill = { background: string; color: string };

type Company = { company: string; pill: LinePill; lines: string[] };

// COME tiene dos grupos con colores distintos; en COPSA van juntas las de Montevideo y las de Canelones.
const COMPANIES: Company[] = [
  {
    company: "CUTCSA",
    pill: { background: "#0080FF", color: "#FFFFFF" },
    lines: [
      "21", "60", "62", "64", "100", "102", "103", "104", "105", "106", "109", "110", "111", "112", "113", "115", "116", "117",
      "121", "124", "124 SD", "125", "127", "128", "130", "133", "135", "137", "140", "141", "142", "143", "144", "145", "147",
      "148", "149", "150", "151", "155", "156", "157", "158", "163", "169", "174", "175", "180", "181", "182", "183", "185",
      "186", "187", "188", "191", "192", "195", "199", "214", "227", "230", "230D", "268", "276", "C1", "C2", "C3", "C4", "C5",
      "CE1", "D1", "D10", "D5", "D8", "DM1", "E14", "G10", "G11", "G3", "G6", "G8", "L1", "L15", "L2", "L20", "L22", "L23",
      "L26", "L28", "L3", "L30", "L35", "L36", "L39", "L4", "L41", "L46", "L5", "L6", "L8", "L9",
    ],
  },
  {
    company: "COETC",
    pill: { background: "#FF3B30", color: "#FFFFFF" },
    lines: [
      "2", "4A", "4AC", "4AD", "4D", "4DR", "5D", "48D", "76", "222", "402", "404", "405", "407", "409", "427", "456", "468",
      "494", "495", "600", "D222", "D9", "L14", "L16", "L19", "L29", "L7", "L77",
    ],
  },
  {
    company: "UCOT",
    pill: { background: "#FFCC00", color: "#1C1C1E" },
    lines: [
      "8SR", "11A", "11S", "11T", "17", "71", "79", "221", "300", "306", "316", "328", "329", "330", "370", "396", "L12", "L13",
      "L31", "L32", "L33", "U11C",
    ],
  },
  {
    company: "COME",
    pill: { background: "#F97316", color: "#FFFFFF" },
    lines: [
      "1M1", "1M11", "1M12", "1M13", "1M14", "1M15", "1M16", "1M2", "1M4", "1M5", "1M6", "1M7", "1M8", "2M1", "2M3", "2M5",
      "2M6", "2M7", "2M8", "D11", "MD1", "MD3", "ML1", "ML2",
    ],
  },
  {
    company: "COME",
    pill: { background: "#34C759", color: "#1C1C1E" },
    lines: ["505", "522", "524", "526", "538", "546", "582", "L24", "L25", "L38"],
  },
  {
    company: "COPSA",
    pill: { background: "#800020", color: "#FFFFFF" },
    lines: [
      "1A", "2A", "7A", "7E5", "7E7R", "7E8D", "7E8R", "7H", "8A", "8E7R", "8E8R", "700", "701", "703", "704", "705", "706",
      "707", "708", "709", "710", "711", "712", "714", "724", "747", "748", "750", "751", "752", "757", "802", "803", "804",
      "807", "808", "809", "810",
      // Canelones
      "P756", "P757", "P758", "P759", "P760", "P761", "P768", "P7A", "P7H", "P802", "P804", "XA1", "XA2",
    ],
  },
  {
    company: "TPM",
    pill: { background: "#6B7F99", color: "#FFFFFF" },
    lines: ["10A", "14A", "14AB", "14AR", "T1", "T14A", "T14B", "T2", "T3N", "T4N", "T4R", "T5", "T6", "T9A"],
  },
  {
    company: "Casanova",
    pill: { background: "#7DD3FC", color: "#1C1C1E" },
    lines: ["6A", "6R6", "15A", "15B", "N33", "N6"],
  },
  {
    company: "CITA",
    pill: { background: "#D4A017", color: "#1C1C1E" },
    lines: ["2K"],
  },
];

/** Sin espacios y en mayúsculas: "124 SD" y "124sd" son la misma línea. */
const normalize = (line: string) => line.replace(/\s+/g, "").toUpperCase();

const BY_LINE = new Map<string, LinePill>(
  COMPANIES.flatMap((company) => company.lines.map((line) => [normalize(line), company.pill] as const)),
);

/** Colores de la línea; null si no está en ninguna empresa (el chip queda con el estilo neutro). */
export function linePill(line: string): LinePill | null {
  return BY_LINE.get(normalize(line)) ?? null;
}
