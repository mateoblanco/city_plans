import type { DayHours } from "@/server/places/google";
import { DAY_NAMES } from "@/server/search/labels";
import HoursToggle from "./HoursToggle/HoursToggle";
import styles from "./PlaceHours.module.scss";

type Props = {
  week: DayHours[];
  /** Día de hoy en Montevideo (0 = domingo). */
  today: number;
  /** Sin tarjeta propia (va dentro de PlaceInfoCard). */
  bare?: boolean;
};

const dayName = (day: number) => DAY_NAMES.es[day].charAt(0).toUpperCase() + DAY_NAMES.es[day].slice(1);

const hoursText = (day: DayHours) => (day.allDay ? "Abierto 24 horas" : day.ranges.length ? day.ranges.join(", ") : "Cerrado");

/**
 * Horarios de Google: los 7 días, de lunes a domingo, con hoy resaltado. En mobile, sólo hoy ("Hoy · 10:00 – 20:00")
 * y "Ver todos" despliega la semana (HoursToggle).
 */
const PlaceHours = (props: Props) => (
  <section className={styles.card} data-bare={props.bare || undefined}>
    <h2 className={styles.title}>Horarios</h2>
    <HoursToggle>
      <dl className={styles.days}>
        {props.week.map((day) => {
          const today = day.day === props.today;
          return (
            <div key={day.day} className={styles.day} data-today={today || undefined}>
              <dt>
                <span className={styles.dayName}>{dayName(day.day)}</span>
                {today && (
                  <span className={styles.todayLabel}>
                    Hoy <span aria-hidden>·</span>
                  </span>
                )}
              </dt>
              <dd>{hoursText(day)}</dd>
            </div>
          );
        })}
      </dl>
    </HoursToggle>
  </section>
);

export default PlaceHours;
