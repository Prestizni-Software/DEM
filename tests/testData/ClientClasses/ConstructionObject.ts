import { MongoId } from "./enums.js";
import {
  classProp,
  classRef,
  populatedRef,
} from "../../../CommonTypes.js";
import { Construction } from "./Construction.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";
import { Company } from "./Company.js";
import { Subordinate } from "./Subordinate.js";

export class ConstructionObject extends AutoUpdatedClientObject<any> {
  @classProp
  public _id: MongoId;

  //Stavební objekt samotný
  @classProp
  public number: string;

  @classProp
  @classRef()
  public company?: Company;

  @classProp
  @classRef()
  public siteManagers?: Subordinate[];

  //parent construction
  @classProp
  @populatedRef("Construction:objects")
  public parent: Construction;

  @classProp
  public path: string;
}


