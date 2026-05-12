import { MongoId } from "@/backend/types";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";
import { classProp } from "@prestizni-software/client-dem/dist/CommonTypes";

export class Element extends AutoUpdatedClientObject<any> {
  @classProp
  _id: MongoId;

  @classProp
  name: string;
}
