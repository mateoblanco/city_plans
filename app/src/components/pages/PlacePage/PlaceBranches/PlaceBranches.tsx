import type { BranchCardData } from "@/server/places/page-data";
import PlaceSection from "../PlaceSection/PlaceSection";
import BranchCard from "./BranchCard/BranchCard";
import styles from "./PlaceBranches.module.scss";

type Props = {
  /** Llegan de la base, después de la fila (PlacePage lo pone en su propio Suspense). */
  branches: Promise<BranchCardData[]>;
};

/** "Otras sucursales" de la marca, sin el lugar actual. Sin sucursales, no se muestra. */
const PlaceBranches = async (props: Props) => {
  const branches = await props.branches;
  if (branches.length === 0) return null;

  return (
    <PlaceSection title="Otras sucursales">
      <div className={styles.grid}>
        {branches.map((branch) => (
          <BranchCard key={branch.id} slug={branch.slug} neighborhood={branch.neighborhood} />
        ))}
      </div>
    </PlaceSection>
  );
};

export default PlaceBranches;
