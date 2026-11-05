import type { BranchCardData } from "@/server/places/page-data";
import PlaceSection from "../PlaceSection/PlaceSection";
import BranchCard from "./BranchCard/BranchCard";
import styles from "./PlaceBranches.module.scss";

type Props = {
  branches: BranchCardData[];
};

/** "Otras sucursales" de la marca, sin el lugar actual. Sin sucursales, no se muestra. */
const PlaceBranches = (props: Props) => {
  if (props.branches.length === 0) return null;

  return (
    <PlaceSection title="Otras sucursales">
      <div className={styles.grid}>
        {props.branches.map((branch) => (
          <BranchCard key={branch.id} slug={branch.slug} neighborhood={branch.neighborhood} address={branch.address} />
        ))}
      </div>
    </PlaceSection>
  );
};

export default PlaceBranches;
