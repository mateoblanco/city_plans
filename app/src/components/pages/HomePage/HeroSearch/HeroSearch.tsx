import Image from "next/image";
import Search from "@/components/Search/Search";
import heroImage from "@/assets/hero_image.png";
import HomeShortcuts from "../HomeShortcuts/HomeShortcuts";
import styles from './HeroSearch.module.scss';

/** El hero de desktop. En mobile no se muestra: el buscador y los accesos van en el header (HomePage). */
const HeroSearch = () => {
  return (
    <div className={styles.hero}>
      <Image src={heroImage} alt="" fill priority sizes="100vw" className={styles.backdrop} />
      <h1 className={styles.heading}>Descubrí lugares para salir hoy</h1>
      <div className={styles.search}>
        <Search />
        <HomeShortcuts layout="wrap" />
      </div>
    </div>
  );
};

export default HeroSearch;
