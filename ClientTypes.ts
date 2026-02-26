import { AutoUpdatedClientObject } from "./AutoUpdatedClientObjectClass.js";
import { classProp, classRef, populatedRef } from "./CommonTypes.js";
import { Status, Objekt } from "./TestTypes.js";


export class Test extends AutoUpdatedClientObject<Test> {
  @classProp
  public _id!: string;

  @classProp
  public active!: boolean;

  @classProp
  public status!: Status;

  @classProp
  public description!: string | null;

  @classProp
  @classRef()
  public ref!: Test | null;

  @classProp
  @classRef()
  public refarr!: Test[];

  @classProp
  public obj!: Objekt | null;

  @classProp
  @populatedRef("Test:refarr")
  public parent!: Test | null;
}

export class Test2 extends AutoUpdatedClientObject<any> {
  @classProp
  public _id!: string;
}
