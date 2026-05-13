import { MongoId } from "./enums.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";
import { classProp } from "../../../CommonTypes.js";

export class MeasurementType extends AutoUpdatedClientObject<any> {
  @classProp
  _id: MongoId;

  @classProp
  name: string;
}


