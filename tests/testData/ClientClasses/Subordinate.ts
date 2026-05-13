import type { MongoId, SubordinateType } from "./enums.js";
import {
  classProp,
  classRef,
} from "../../../CommonTypes.js";
import { Company } from "./Company.js";
import { Construction } from "./Construction.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";

export class Subordinate extends AutoUpdatedClientObject<any> {
  @classProp
  public _id!: MongoId;

  @classProp
  public login!: string;

  @classProp
  public name!: string;

  @classProp
  public phone!: string;

  @classProp
  public type!: SubordinateType; // discriminator key

  //id of company where the subordinate is employed
  @classProp
  @classRef()
  public company?: Company[];

  //id of construction where the subordinate is currently on site
  @classProp
  @classRef()
  public onSite!: Construction;
}
