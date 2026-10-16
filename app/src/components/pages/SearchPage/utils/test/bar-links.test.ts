// Tests generados desde la configuración de intenciones (shared/intents.ts), del lado de los links de la barra:
// para cada intención y cada sub-filtro, prender y apagar el sub-filtro, apagar la intención y cambiar a cada otra.
// La URL resultante tiene que conservar q, barrio, abierto ahora, dietas y cerca mío, y no dejar nada de la
// intención anterior. Cada URL se vuelve a buscar para ver qué entiende el servidor.
import { describe, expect, it } from "vitest";
import { INTENT_IDS, INTENTS, type IntentDef, type IntentId } from "@shared/intents.ts";
import { findDef } from "@shared/tags.ts";
import { intentGroups } from "@/server/search/intents";
import { runSearch, type SearchResponse } from "@/server/search/search";
import { fakeCache, fakeStore, row } from "@/server/search/test/fixtures";
import { intentHref, subHref, type SearchUrl } from "../search-href";

const now = new Date("2026-10-12T16:00:00Z");
// Barrio, abierto ahora y dieta (todo en f) más cerca mío: lo que ningún cambio de intención puede tocar.
const KEPT = { f: "neighborhood:CORDON,open:now,diet:vegan", near: "-34.905,-56.185" };

const places = [
  row({ id: "bar", categories: ["bar"], tags: ["classic_cocktails", "live_music"] }),
  row({ id: "cafe", categories: ["cafe"], tags: ["specialty_coffee", "brunch"] }),
  row({ id: "resto", categories: ["restaurant"], tags: ["dinner"] }),
  row({ id: "heladeria", categories: ["ice_cream_shop"], tags: ["ice_cream"] }),
];

const def = (id: IntentId): IntentDef => INTENTS[id];
const subIds = (id: IntentId) => Object.keys(def(id).subs);

/** Texto que activa el sub-filtro: el label del primer tag o categoría que lo define. */
const subText = (intent: IntentId, sub: string) => {
  const { tags = [], categories = [] } = def(intent).subs[sub];
  const id = tags[0] ?? categories[0];
  return findDef(id)!.label.es;
};

const read = (href: string) => new URL(href, "http://x").searchParams;
const list = (raw: string | null) => (raw ? raw.split(",") : []);

const toUrl = (href: string): SearchUrl => {
  const params = read(href);
  return { q: params.get("q") ?? "", remove: params.get("remove"), intent: params.get("intent"), sub: params.get("sub"), f: params.get("f"), near: params.get("near") };
};

async function search(state: SearchUrl): Promise<SearchResponse> {
  const { store } = fakeStore(places);
  return runSearch(state.q, { store, cache: fakeCache().cache }, { now, debug: true, remove: state.remove, intent: state.intent, sub: state.sub, filters: state.f, near: state.near });
}

/** q, barrio, abierto ahora, dietas y cerca mío, iguales que antes. */
function expectKept(href: string, state: SearchUrl) {
  const params = read(href);
  expect(params.get("q") ?? "", "q").toBe(state.q);
  expect(list(params.get("f")).sort(), "f (barrio, abierto ahora, dietas)").toEqual(list(KEPT.f).sort());
  expect(params.get("near"), "cerca mío").toBe(KEPT.near);
}

/**
 * Ninguna categoría del texto a remove (el bug de "bar con amigos"), salvo las que activaron el sub-filtro que la
 * persona apaga a mano ("heladería" → Helado ×): eso es quitarlo a propósito.
 */
function expectNoCategoryRemoved(href: string, state: SearchUrl, allowed: string[] = []) {
  const added = list(read(href).get("remove")).filter((key) => !list(state.remove ?? null).includes(key) && !allowed.includes(key));
  expect(added.filter((key) => key.startsWith("category:")), "categorías quitadas por la barra").toEqual([]);
}

type Scenario = { name: string; intent: IntentId; state: SearchUrl };

/** Cada intención elegida en la URL (sin sub-filtros y con cada uno), con cada sub-filtro desde el texto y desde un alias. */
function scenarios(intent: IntentId): Scenario[] {
  const base = { ...KEPT, q: "con amigos" };
  return [
    { name: "elegida en la barra", intent, state: { ...base, intent } },
    ...subIds(intent).map((sub) => ({ name: `con ${sub} en la URL`, intent, state: { ...base, intent, sub } })),
    ...subIds(intent).map((sub) => ({ name: `con ${sub} desde el texto`, intent, state: { ...KEPT, q: subText(intent, sub), intent } })),
    ...def(intent).aliases.map((alias) => ({ name: `desde el texto (${alias})`, intent, state: { ...KEPT, q: findDef(alias)!.label.es } })),
  ];
}

describe.each(INTENT_IDS)("links de la barra: %s", (intentId) => {
  for (const { name, intent, state } of scenarios(intentId)) {
    describe(name, () => {
      const start = () =>
        search(state).then((response) => {
          expect(response.bar.intent?.id, `"${state.q}" con ${state.intent ?? "sin intención"}`).toBe(intent);
          return response;
        });

      if (name.endsWith("desde el texto")) {
        it("el texto activa el sub-filtro", async () => {
          const { bar } = await start();
          expect(bar.subs.filter((sub) => sub.active && sub.fromText).length, `"${state.q}"`).toBeGreaterThan(0);
        });
      }

      for (const sub of subIds(intent)) {
        it(`prender o apagar ${sub}`, async () => {
          const { bar } = await start();
          const toggled = bar.subs.find((item) => item.id === sub)!;
          const wasActive = toggled.active;
          const href = subHref(state, sub, bar);
          expectKept(href, state);
          expectNoCategoryRemoved(href, state, toggled.removeKeys);
          expect(read(href).get("intent"), "la intención queda fija").toBe(intent);

          const next = await search(toUrl(href));
          expect(next.bar.intent?.id).toBe(intent);
          expect(next.bar.subs.find((item) => item.id === sub)!.active, `${sub} ${wasActive ? "apagado" : "prendido"}`).toBe(!wasActive);
          // Los demás sub-filtros no cambian.
          const others = (response: SearchResponse) => response.bar.subs.filter((item) => item.id !== sub).map((item) => [item.id, item.active]);
          expect(others(next)).toEqual(others(await start()));
        });
      }

      it("apagar la intención", async () => {
        const first = await start();
        const href = intentHref(state, null, first.bar);
        expectKept(href, state);
        expectNoCategoryRemoved(href, state);
        expect(read(href).get("intent"), "intent").toBeNull();
        expect(read(href).get("sub"), "sub").toBeNull();

        const next = await search(toUrl(href));
        expect(next.bar.intent, "sin intención").toBeNull();
        expect(next.bar.subs).toEqual([]);
        // Lo que el texto exige sigue: ninguna categoría pasa a descartada por la barra.
        expect(next.debug!.must.trace.filter((entry) => entry.item.startsWith("category:")).every((entry) => entry.outcome === "filter")).toBe(true);
      });

      for (const other of INTENT_IDS.filter((id) => id !== intent)) {
        it(`cambiar a ${other}`, async () => {
          const first = await start();
          const href = intentHref(state, other, first.bar);
          expectKept(href, state);
          expectNoCategoryRemoved(href, state);
          expect(read(href).get("intent")).toBe(other);
          expect(read(href).get("sub"), "sin sub-filtros de la anterior").toBeNull();

          const { store, calls } = fakeStore(places);
          const next = await runSearch(read(href).get("q") ?? "", { store, cache: fakeCache().cache }, { now, debug: true, ...optionsOf(href) });
          expect(next.bar.intent?.id).toBe(other);
          expect(next.bar.textIntent === intent, "la intención anterior no vuelve desde el texto").toBe(false);
          // Nada de la anterior: ningún sub-filtro activo y sólo el grupo de la nueva intención.
          expect(next.bar.subs.filter((item) => item.active).map((item) => item.id)).toEqual([]);
          expect(calls[0].filters.groups).toEqual(intentGroups(other, []));
        });
      }
    });
  }
});

const optionsOf = (href: string) => {
  const url = toUrl(href);
  return { remove: url.remove, intent: url.intent, sub: url.sub, filters: url.f, near: url.near };
};
