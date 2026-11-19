import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * La guía es igual para todos y cacheada: su render (la ruta y todo lo que importa como valor) no lee datos del pedido
 * (headers, cookies, searchParams, connection), no llama a Google Places y no calcula la hora en el servidor. El mapa
 * (Maps JS, que se paga) sólo se monta con useDeferredMount en desktop o al abrir el diálogo en mobile, y nunca para
 * bots. Estos tests fallan si algo de eso cambia.
 */
const SRC = path.resolve(import.meta.dirname, "../../../..");
const ROUTE = "app/guides/montevideo/[segment]/[slug]/page.tsx";
const SEGMENT_ROUTE = "app/guides/montevideo/[segment]/page.tsx";
const CITY_ROUTE = "app/guides/montevideo/page.tsx";
const ROUTES = [ROUTE, SEGMENT_ROUTE, CITY_ROUTE];
const read = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");
const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const EXTENSIONS = [".ts", ".tsx", ".mts"];

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = path.join(path.dirname(from), specifier);
  else return null;
  if (fs.existsSync(path.join(SRC, base)) && fs.statSync(path.join(SRC, base)).isFile()) return base;
  return EXTENSIONS.map((ext) => base + ext).find((candidate) => fs.existsSync(path.join(SRC, candidate))) ?? null;
}

function valueImports(file: string): string[] {
  const source = parse(file);
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier) continue;
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const named = clause?.namedBindings;
      if (clause?.isTypeOnly) continue;
      if (clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((el) => el.isTypeOnly)) continue;
    } else if (statement.isTypeOnly) continue;
    found.push((statement.moduleSpecifier as ts.StringLiteral).text);
  }
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text);
    node.forEachChild(walk);
  };
  walk(source);
  return found;
}

function renderGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [...ROUTES];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (graph.has(file)) continue;
    const specifiers = valueImports(file);
    graph.set(file, specifiers);
    for (const specifier of specifiers) {
      const resolved = resolveImport(file, specifier);
      if (resolved && !graph.has(resolved)) queue.push(resolved);
    }
  }
  return graph;
}

const OWN = (file: string) =>
  file.startsWith(path.join("components/pages/GuidePage")) ||
  file.startsWith(path.join("components/pages/GuideNeighborhoodPage")) ||
  file.startsWith(path.join("components/pages/GuidesCityPage")) ||
  file.startsWith(path.join("components/GuideBreadcrumb")) ||
  file.startsWith(path.join("components/GuideRow")) ||
  file.startsWith(path.join("components/GuidesShell")) ||
  file.startsWith(path.join("server/guides")) ||
  ROUTES.includes(file);

describe("las páginas de guías (ciudad, barrio y guía) se arman igual para todos, sin Google", () => {
  const graph = renderGraph();

  it("el grafo es el de la guía (página, datos, lista y mapa)", () => {
    expect([...graph.keys()]).toEqual(
      expect.arrayContaining([
        path.join("components/pages/GuidePage/GuidePage.tsx"),
        path.join("server/guides/page-data.ts"),
        path.join("components/pages/GuidePage/GuidePlaces/GuideMap/GuideMap.tsx"),
        path.join("components/pages/GuideNeighborhoodPage/GuideNeighborhoodPage.tsx"),
        path.join("server/guides/neighborhood-data.ts"),
        path.join("components/pages/GuidesCityPage/GuidesCityPage.tsx"),
        path.join("server/guides/city-data.ts"),
      ]),
    );
  });

  it("ningún módulo importa server/places/google ni nombra la API de Places", () => {
    const offenders = [...graph.entries()].flatMap(([file, specifiers]) => [
      ...specifiers.filter((specifier) => resolveImport(file, specifier) === path.join("server/places/google.ts")).map((s) => `${file} importa ${s}`),
      ...(/places\.googleapis\.com|fetchPlaceDetails/.test(read(file)) ? [`${file} nombra Places`] : []),
    ]);
    expect(offenders).toEqual([]);
  });

  it("los módulos de la guía no leen datos del pedido ni la hora en el servidor", () => {
    const offenders = [...graph.keys()]
      .filter(OWN)
      .filter((file) => /from "next\/headers"|from 'next\/headers'|\bconnection\(|searchParams|montevideoNow\(/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("los datos de las dos páginas están cacheados ('use cache' con tag y vida en horas) y se prerenderizan", () => {
    for (const file of ["server/guides/page-data.ts", "server/guides/neighborhood-data.ts", "server/guides/city-data.ts"]) {
      const text = read(file);
      expect(text).toMatch(/'use cache'/);
      expect(text).toMatch(/cacheTag\('guides'\)/);
      expect(text).toMatch(/cacheLife\('hours'\)/);
    }
    expect(read(ROUTE)).toMatch(/generateStaticParams/);
    expect(read(SEGMENT_ROUTE)).toMatch(/generateStaticParams/);
  });

  it("las páginas de barrio y de ciudad no tienen mapa", () => {
    const offenders = [...renderGraph().keys()]
      .filter((file) => ["components/pages/GuideNeighborhoodPage", "components/pages/GuidesCityPage", "components/GuideRow"].some((dir) => file.startsWith(path.join(dir))))
      .filter((file) => /react-google-maps|GuideMap|maps-loader/.test(read(file)));
    expect(offenders).toEqual([]);
  });
});

describe("el mapa de la guía no se paga para bots ni sin mirarlo", () => {
  it("bots: la decisión es isBot en el cliente, y sin ella no hay columna montada ni botón", () => {
    const root = read("components/pages/GuidePage/GuidePlaces/GuidePlaces.tsx");
    expect(root).toMatch(/!isBot\(navigator\.userAgent\)/);
    expect(root).toMatch(/<GuideMapColumn pins=\{pins\} enabled=\{canMap\} \/>/);
    expect(root).toMatch(/\{canMap && pins\.length > 0 && <GuideMapDialog/);
  });

  it("desktop: GuideMap sólo con useDeferredMount; mobile: sólo después de abrir", () => {
    const column = read("components/pages/GuidePage/GuidePlaces/GuideMapColumn/GuideMapColumn.tsx");
    expect(column).toMatch(/const ready = useDeferredMount\(ref, "md", props\.enabled && props\.pins\.length > 0\)/);
    expect(column).toMatch(/\{ready && <GuideMap /);
    const dialog = read("components/pages/GuidePage/GuidePlaces/GuideMapDialog/GuideMapDialog.tsx");
    expect(dialog).toMatch(/\{opened && <GuideMap /);
    // Los dos con next/dynamic sin SSR: el chunk de Maps no viene en el HTML.
    for (const text of [column, dialog]) expect(text).toMatch(/dynamic\(\(\) => import\("\.\.\/GuideMap\/GuideMap"\), \{ ssr: false \}\)/);
  });
});
