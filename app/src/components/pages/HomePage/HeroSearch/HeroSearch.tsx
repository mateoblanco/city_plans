import Search from "@/components/Search/Search";
import styles from './HeroSearch.module.scss';

const HeroSearch = () => {
  return (
    <div className={styles.hero}>
      <h1 className={styles.heading}>Descubrí lugares para salir hoy</h1>
      <Search />
    </div>
  );
};

export default HeroSearch;