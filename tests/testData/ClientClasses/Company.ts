import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";
import { MongoId } from "../../types";
import { classProp } from "@prestizni-software/client-dem/dist/CommonTypes";

export class Company extends AutoUpdatedClientObject<any> {
  @classProp
  public _id: MongoId;

  @classProp
  public fullName: string;

  @classProp
  public abbr: string;
}
