import {
  classProp,
  classRef,
} from "@prestizni-software/client-dem/dist/CommonTypes";
import { MongoId } from "../../types";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";
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
