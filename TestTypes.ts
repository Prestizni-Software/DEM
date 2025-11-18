export enum Status {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export type Objekt = {
  _id: string;
  obj: Objekt2
}

export type Objekt2 = {
  _id: string;
}
