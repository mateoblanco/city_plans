import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Cada Place Details cuesta (~USD 0,02 el lugar) y lo pagaba cualquier render de una ficha, también el de un bot. Ahora
 * el render del servidor de /place/[slug] sale sólo con datos propios y lo de Google lo pide el navegador una vez, en un
 * efecto, a /api/place-google/[id] (que no llama a Google para bots). La precarga de los links tampoco paga: el prefetch
 * por defecto de Next trae el shell estático (PPR) y los efectos no corren. Estos tests fallan si algo de eso cambia:
 * un módulo del render de la ficha que llegue a Places, Place Details pedido desde otro lado que no sea la ruta, el
 * pedido a la ruta fuera de un efecto de cliente, un prefetch explícito en un link a la ficha o generateStaticParams.
 */
const SRC = path.resolve(import.meta.dirname, "../../../..");
const read = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");
const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const walk = (node: ts.Node, visit: (node: ts.Node) => void) => {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
};

const filesUnder = (dir: string): string[] =>
  fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : filesUnder(rel);
    return /\.(tsx?|mts)$/.test(entry.name) ? [rel] : [];
  });

type JsxOpening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
const openings = (source: ts.SourceFile, tag: string): JsxOpening[] => {
  const found: JsxOpening[] = [];
  walk(source, (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === tag) found.push(node);
  });
  return found;
};
const attribute = (node: JsxOpening, name: string) =>
  node.attributes.properties.find((prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText() === name);

/**
 * Los links a una ficha en todo src/: los <Link> cuyo href apunta a `/place/...` y los <OriginLink> (el <Link> a la
 * ficha que recuerda el origen para la popularidad; arma el href con el slug).
 */
function placeLinks() {
  return filesUnder(".")
    .filter((file) => file.endsWith(".tsx"))
    .flatMap((file) => {
      const source = parse(file);
      return [
        ...openings(source, "Link").filter((link) => attribute(link, "href")?.initializer?.getText(source).includes("/place/")),
        ...openings(source, "OriginLink"),
      ].map((link) => ({ file, link, source }));
    });
}

describe("precarga de fichas sin costo de Google Places", () => {
  it("los links de la card y de la sucursal existen y apuntan a la ficha", () => {
    const files = placeLinks().map(({ file }) => file);
    expect(files).toContain(path.join("components/pages/SearchPage/Results/PlaceCard/PlaceCard.tsx"));
    expect(files).toContain(path.join("components/pages/PlacePage/PlaceBranches/BranchCard/BranchCard.tsx"));
    expect(files).toContain(path.join("components/Tracking/OriginLink/OriginLink.tsx"));
  });

  it("OriginLink no deja pasar props al <Link> (como prefetch): sólo href, className, onClick y children", () => {
    const file = "components/Tracking/OriginLink/OriginLink.tsx";
    const source = parse(file);
    const [link] = openings(source, "Link");
    const props = link.attributes.properties.map((prop) => (ts.isJsxAttribute(prop) ? prop.name.getText() : "...spread"));
    expect(props.sort()).toEqual(["className", "href", "onClick"]);
  });

  it("ningún <Link> a una ficha cambia el prefetch por defecto (nada de prefetch={true})", () => {
    const explicit = placeLinks()
      .filter(({ link }) => attribute(link, "prefetch"))
      .map(({ file, link, source }) => `${file}: ${link.getText(source)}`);
    expect(explicit).toEqual([]);
  });

  it("la ruta de la ficha no prerenderiza fichas ni llama a Google en la metadata", () => {
    const route = read("app/place/[slug]/page.tsx");
    expect(route).not.toMatch(/generateStaticParams/);
    expect(route).not.toMatch(/page-data|places\/google|fetchPlaceDetails/);
  });

  it("Place Details sólo se pide desde la ruta del navegador (app/api/place-google/[id]/route.ts)", () => {
    const importers = filesUnder(".")
      .filter((file) => !file.endsWith(path.join("server/places/google.ts")))
      .filter((file) => /fetchPlaceDetails/.test(read(file)));
    expect(importers).toEqual([path.join("app/api/place-google/[id]/route.ts")]);
  });
});

/**
 * Los módulos que carga el render de /place/[slug] (la ruta y todo lo que importa, también los componentes de cliente,
 * que se renderizan en el servidor): imports y re-exports de valor, resueltos con `@/` y rutas relativas. Los
 * `import type` no cuentan (no se ejecutan). Lo de node_modules y @shared queda afuera.
 */
const EXTENSIONS = [".ts", ".tsx", ".mts"];

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = path.join(path.dirname(from), specifier);
  else return null;
  if (fs.existsSync(path.join(SRC, base)) && fs.statSync(path.join(SRC, base)).isFile()) return base;
  const match = EXTENSIONS.map((ext) => base + ext).find((candidate) => fs.existsSync(path.join(SRC, candidate)));
  return match ?? null;
}

const typeOnly = (node: ts.ImportDeclaration | ts.ExportDeclaration) => {
  if (ts.isExportDeclaration(node)) return node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every((el) => el.isTypeOnly));
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((el) => el.isTypeOnly);
};

function valueImports(file: string): string[] {
  const source = parse(file);
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier) continue;
    if (typeOnly(statement)) continue;
    found.push((statement.moduleSpecifier as ts.StringLiteral).text);
  }
  // import() dinámico (next/dynamic): también se carga.
  walk(source, (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text);
  });
  return found;
}

function placeRenderGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = ["app/place/[slug]/page.tsx"];
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

const GOOGLE_MODULE = path.join("server/places/google.ts");

describe("el render del servidor de la ficha no llama a Google Places", () => {
  const graph = placeRenderGraph();

  it("el grafo es el de la ficha (incluye la página, los datos de la base y el pedido del navegador)", () => {
    expect([...graph.keys()]).toEqual(
      expect.arrayContaining([
        path.join("components/pages/PlacePage/PlacePage.tsx"),
        path.join("server/places/page-data.ts"),
        path.join("components/pages/PlacePage/PlaceGoogle/PlaceGoogle.tsx"),
      ]),
    );
  });

  it("ningún módulo del render importa (como valor) server/places/google ni la API de Places", () => {
    const offenders = [...graph.entries()].flatMap(([file, specifiers]) => [
      ...specifiers.filter((specifier) => resolveImport(file, specifier) === GOOGLE_MODULE).map((specifier) => `${file} importa ${specifier}`),
      ...(/places\.googleapis\.com|fetchPlaceDetails/.test(read(file)) ? [`${file} nombra Places`] : []),
    ]);
    expect(offenders).toEqual([]);
  });

  it("el pedido a /api/place-google sale sólo de loadPlaceGoogle, y loadPlaceGoogle sólo de un useEffect de cliente", () => {
    const routeUsers = filesUnder(".")
      .filter((file) => !file.startsWith(path.join("app/api/place-google")))
      .filter((file) => {
        // En el código (strings y templates), no en los comentarios.
        let uses = false;
        walk(parse(file), (node) => {
          if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && node.text.includes("/api/place-google")) uses = true;
        });
        return uses;
      });
    expect(routeUsers.sort()).toEqual([path.join("components/pages/PlacePage/PlaceGoogle/utils/load.ts"), path.join("server/seo/indexing.ts")]);

    const callers = filesUnder(".")
      .filter((file) => !file.endsWith(path.join("PlaceGoogle/utils/load.ts")))
      .filter((file) => /loadPlaceGoogle/.test(read(file)));
    expect(callers).toEqual([path.join("components/pages/PlacePage/PlaceGoogle/PlaceGoogle.tsx")]);

    const file = callers[0];
    const source = parse(file);
    expect(read(file).trimStart().startsWith('"use client"')).toBe(true);
    const calls: string[] = [];
    walk(source, (node) => {
      if (!ts.isCallExpression(node) || node.expression.getText(source) !== "loadPlaceGoogle") return;
      let parent: ts.Node | undefined = node.parent;
      while (parent && !(ts.isCallExpression(parent) && parent.expression.getText(source) === "useEffect")) parent = parent.parent;
      calls.push(parent ? "useEffect" : "fuera de un efecto");
    });
    expect(calls).toEqual(["useEffect"]);
  });
});

describe("el mapa de la ficha no se paga para bots ni fuera de pantalla", () => {
  const file = "components/pages/PlacePage/PlacePage.tsx";
  const source = parse(file);

  it("el servidor decide por user agent con isBot (headers) y le pasa plain={bot} al mapa", () => {
    expect(read(file)).toMatch(/const bot = isBot\(\(await headers\(\)\)\.get\("user-agent"\)\)/);
    const maps = openings(source, "PlaceMap");
    expect(maps.length).toBeGreaterThan(0);
    for (const map of maps) expect(attribute(map, "plain")?.initializer?.getText(source)).toBe("{bot}");
  });

  it("a un bot tampoco se le pide lo de Google desde el navegador (PlaceGoogle enabled sin bot)", () => {
    expect(read(file)).toMatch(/const inGoogle = !!place\.google_place_id && !bot;/);
    const providers = openings(source, "PlaceGoogle");
    expect(providers.map((node) => attribute(node, "enabled")?.initializer?.getText(source))).toEqual(["{inGoogle}"]);
  });

  it("la imagen de Static Maps sólo se renderiza con !bot", () => {
    const staticMaps = openings(source, "StaticMap");
    expect(staticMaps.length).toBeGreaterThan(0);
    for (const node of staticMaps) {
      let parent: ts.Node | undefined = node.parent;
      let guarded = false;
      while (parent && !guarded) {
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.left.getText(source) === "!bot") guarded = true;
        parent = parent.parent;
      }
      expect(guarded, `<StaticMap> sin {!bot && …} en ${file}`).toBe(true);
    }
  });

  it("Maps JS (MapView) sólo se monta con useDeferredMount (visible, desktop, después del load) y nunca con plain", () => {
    const mapFile = "components/pages/PlacePage/PlaceMap/PlaceMap.tsx";
    const text = read(mapFile);
    expect(text).toMatch(/const ready = useDeferredMount\(ref, "ml", !props\.plain\)/);
    expect(text).toMatch(/\{ready && <MapView /);
    expect(text).toMatch(/if \(props\.plain\) return/);
    expect(read("components/pages/PlacePage/PlaceMap/use-deferred-mount.ts")).toMatch(/IntersectionObserver/);
    const mapViewUsers = filesUnder(".").filter((f) => f.endsWith(".tsx") && openings(parse(f), "MapView").length > 0);
    expect(mapViewUsers).toEqual([path.join(mapFile)]);
  });
});
