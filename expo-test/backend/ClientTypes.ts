import { classProp, classRef, populatedRef } from "@prestizni-software/client-dem/dist/CommonTypes.js";
import { Status, Objekt } from "./TestTypes.js";


export class Test {
  @classProp
  declare public _id: string;

  @classProp
  declare public active: boolean;

  @classProp
  declare public status: Status;

  @classProp
  declare public description: string | null;

  @classProp
  @classRef()
  declare public ref: Test | null;

  @classProp
  @classRef()
  declare public refarr: Test[];

  @classProp
  declare public obj: Objekt | null;

  @classProp
  @populatedRef("Test:refarr")
  declare public parent: Test | null;
}

export class Test2 {
  @classProp
  declare public _id: string;
}
