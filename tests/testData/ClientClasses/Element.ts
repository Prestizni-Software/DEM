import type { MongoId } from "./enums.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";
import { classProp } from "../../../CommonTypes.js";

export class Element extends AutoUpdatedClientObject<Element> {
  @classProp
  _id!: MongoId;

  @classProp
  name!: string;
}
