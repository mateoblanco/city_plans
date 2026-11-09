import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Cada carga de una ficha paga Google Places (Place Details del lugar y de cada sucursal, ~USD 0,02–0,03). Hoy la
 * precarga de los links no paga nada: el prefetch por defecto de Next trae sólo el shell estático de /place/[slug] (PPR,
 * desde el CDN), porque lo que llama a Google (Details) está dentro de <Suspense>. Estos tests fallan si algo de eso
 * cambia: un prefetch explícito en un link a la ficha, Details fuera de Suspense, generateStaticParams, o Google llamado
 * desde otro lado.
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

/** Los <Link> cuyo href apunta a una ficha (`/place/...`), en todo src/. */
function placeLinks() {
  return filesUnder(".")
    .filter((file) => file.endsWith(".tsx"))
    .flatMap((file) => {
      const source = parse(file);
      return openings(source, "Link")
        .filter((link) => attribute(link, "href")?.initializer?.getText(source).includes("/place/"))
        .map((link) => ({ file, link, source }));
    });
}

describe("precarga de fichas sin costo de Google Places", () => {
  it("los links de la card y de la sucursal existen y apuntan a la ficha", () => {
    const files = placeLinks().map(({ file }) => file);
    expect(files).toContain(path.join("components/pages/SearchPage/Results/PlaceCard/PlaceCard.tsx"));
    expect(files).toContain(path.join("components/pages/PlacePage/PlaceBranches/BranchCard/BranchCard.tsx"));
  });

  it("ningún <Link> a una ficha cambia el prefetch por defecto (nada de prefetch={true})", () => {
    const explicit = placeLinks()
      .filter(({ link }) => attribute(link, "prefetch"))
      .map(({ file, link, source }) => `${file}: ${link.getText(source)}`);
    expect(explicit).toEqual([]);
  });

  it("lo que llama a Google (Details → getPlacePage) se renderiza siempre dentro de <Suspense>", () => {
    const file = "components/pages/PlacePage/PlacePage.tsx";
    const source = parse(file);
    const details = openings(source, "Details");
    expect(details.length).toBeGreaterThan(0);
    for (const node of details) {
      let parent: ts.Node | undefined = node.parent;
      let insideSuspense = false;
      while (parent && !insideSuspense) {
        if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "Suspense") insideSuspense = true;
        parent = parent.parent;
      }
      expect(insideSuspense, `<Details> fuera de <Suspense> en ${file}`).toBe(true);
    }
  });

  it("getPlacePage sólo se llama dentro del componente Details", () => {
    const file = "components/pages/PlacePage/PlacePage.tsx";
    const source = parse(file);
    const callers: string[] = [];
    walk(source, (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "getPlacePage") {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !(ts.isVariableDeclaration(parent) && ts.isArrowFunction(parent.initializer ?? parent))) parent = parent.parent;
        callers.push(parent && ts.isVariableDeclaration(parent) ? parent.name.getText(source) : "(fuera de un componente)");
      }
    });
    expect(callers).toEqual(["Details"]);
  });

  it("la ruta de la ficha no prerenderiza fichas ni llama a Google en la metadata", () => {
    const route = read("app/place/[slug]/page.tsx");
    expect(route).not.toMatch(/generateStaticParams/);
    expect(route).not.toMatch(/page-data|places\/google|fetchPlaceDetails/);
  });

  it("Place Details sólo se pide desde server/places/page-data.ts", () => {
    const importers = filesUnder(".")
      .filter((file) => !file.endsWith(path.join("server/places/google.ts")))
      .filter((file) => /fetchPlaceDetails/.test(read(file)));
    expect(importers).toEqual([path.join("server/places/page-data.ts")]);
  });
});
