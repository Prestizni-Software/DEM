import {
  classProp,
  classRef,
} from "../../../CommonTypes.js";
import { MongoId } from "./enums.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";
export class Construction extends AutoUpdatedClientObject<any> {
  @classProp
  public _id: MongoId;

  @classProp
  public name: string;

  //reference all conObjects
  @classProp
  @classRef()
  public objects: MongoId[];
}


