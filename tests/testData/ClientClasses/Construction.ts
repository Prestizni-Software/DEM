import {
  classProp,
  classRef,
} from "../../../CommonTypes.js";
import type { MongoId } from "./enums.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";
export class Construction extends AutoUpdatedClientObject<Construction> {
  @classProp
  public _id!: MongoId;

  @classProp
  public name!: string;

  //reference all conObjects
  @classProp
  @classRef()
  public objects!: MongoId[];
}
