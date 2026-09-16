import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";
import type { MongoId } from "./enums.js";
import { classProp } from "../../../CommonTypes.js";

export class Company extends AutoUpdatedClientObject<Company> {
  @classProp
  public _id!: MongoId;

  @classProp
  public fullName!: string;

  @classProp
  public abbr!: string;
}
