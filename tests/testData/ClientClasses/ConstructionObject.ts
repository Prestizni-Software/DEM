import { MongoId } from "../../types";
import {
  classProp,
  classRef,
  populatedRef,
} from "@prestizni-software/client-dem/dist/CommonTypes";
import { Construction } from "./Construction";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";
import { Company } from "./Company";
import { Subordinate } from "./Subordinate";

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
