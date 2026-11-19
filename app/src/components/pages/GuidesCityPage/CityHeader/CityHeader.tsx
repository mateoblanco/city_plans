import styles from "./CityHeader.module.scss";

type Props = {
  /** "Guías de Montevideo". */
  title: string;
  intro: string[];
};

/** El título de la ciudad y su intro. Sin migas: es la primera página de las guías. */
const CityHeader = (props: Props) => (
  <header className={styles.header}>
    <h1 className={styles.title}>{props.title}</h1>
    {props.intro.length > 0 && (
      <div className={styles.intro}>
        {props.intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    )}
  </header>
);

export default CityHeader;
