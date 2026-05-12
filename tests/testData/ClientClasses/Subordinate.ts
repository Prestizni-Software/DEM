import { MongoId, SubordinateType } from "../../types";
import {
  classProp,
  classRef,
} from "@prestizni-software/client-dem/dist/CommonTypes";
import { Company } from "./Company";
import { Construction } from "./Construction";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";

export class Subordinate extends AutoUpdatedClientObject<any> {
  @classProp
  public _id: MongoId;

  @classProp
  public login: string;

  @classProp
  public name: string;

  @classProp
  public phone: string;

  @classProp
  public type: SubordinateType; // discriminator key

  //id of company where the subordinate is employed
  @classProp
  @classRef()
  public company?: Company[];

  //id of construction where the subordinate is currently on site
  @classProp
  @classRef()
  public onSite: Construction;
}
