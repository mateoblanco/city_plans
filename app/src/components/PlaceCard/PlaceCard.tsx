type PlaceCardProps = {
  name: string;
};

const PlaceCard = ({ name }: PlaceCardProps) => {
  return (
    <div style={{ aspectRatio: "1 / 1", border: "1px solid black" }}>
      {name}
    </div>
  );
};

export default PlaceCard;
