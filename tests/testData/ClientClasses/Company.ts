import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";
import { MongoId } from "./enums.js";
import { classProp } from "../../../CommonTypes.js";

export class Company extends AutoUpdatedClientObject<any> {
  @classProp
  public _id: MongoId;

  @classProp
  public fullName: string;

  @classProp
  public abbr: string;
}


