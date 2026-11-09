import type { Metadata } from "next";
import Header from "@/components/Header/Header";
import Button from "@/components/base/Button/Button";
import styles from "./not-found.module.scss";

export const metadata: Metadata = { title: "No encontramos este lugar · Salimos" };

/**
 * 404 de toda la app: una ficha que no existe o no está publicada (notFound() antes del stream, status 404 real) y
 * cualquier ruta desconocida.
 */
export default function NotFound() {
  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>No encontramos este lugar</h1>
        <Button href="/" label="Volver" variant="primary" size="md" />
      </main>
    </>
  );
}
