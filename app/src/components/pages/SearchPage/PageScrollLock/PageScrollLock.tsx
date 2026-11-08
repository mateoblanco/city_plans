"use client";

import { useEffect } from "react";

/**
 * Marca <html> con data-search-page mientras /search está a la vista: en mobile la página no scrollea (el mapa es el
 * fondo; SearchPage.module.scss). No alcanza con html:has(.page): al salir de /search, Next deja la página oculta en el
 * DOM para restaurarla al volver, y la home quedaba sin scroll. Al ocultarla, React desmonta este efecto y la marca se va.
 */
const PageScrollLock = () => {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.searchPage = "";
    return () => {
      delete root.dataset.searchPage;
    };
  }, []);

  return null;
};

export default PageScrollLock;
