import Image from "next/image";
import Search from "@/components/Search/Search";
import heroImage from "@/assets/hero_image.webp";
import HomeShortcuts from "../HomeShortcuts/HomeShortcuts";
import styles from './HeroSearch.module.scss';

/** El hero de desktop. En mobile no se muestra: el buscador y los accesos van en el header (HomePage). */
const HeroSearch = () => {
  return (
    <div className={styles.hero}>
      {/* Sólo se ve desde md: debajo, sizes pide la variante mínima (el preload igual se emite y bajaba ~90 KB en mobile). */}
      <Image src={heroImage} alt="" fill preload sizes="(min-width: 768px) 100vw, 1px" className={styles.backdrop} />
      <h1 className={styles.heading}>Descubrí lugares para salir hoy</h1>
      <div className={styles.search}>
        <Search rotatingPlaceholder />
        <HomeShortcuts layout="wrap" />
      </div>
    </div>
  );
};

export default HeroSearch;
