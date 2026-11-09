/** 3 decimales ≈ 100 m: alcanza para "cerca", no identifica la casa de nadie y deja que la cache sirva. */
export const roundCoord = (value: number) => Math.round(value * 1000) / 1000
