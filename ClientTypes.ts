import { AutoUpdated } from "./AutoUpdateClientManagerClass.js";
import { classProp, classRef, populatedRef } from "./CommonTypes.js";
import { Status, Objekt } from "./TestTypes.js";


export class Test {
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
  public ref!: AutoUpdated<Test> | null;

  @classProp
  @classRef()
  public refarr!: AutoUpdated<Test>[];

  @classProp
  public obj!: Objekt | null;

  @classProp
  @populatedRef("Test:refarr")
  public parent!: AutoUpdated<Test> | null;
}

export class Test2 {
  @classProp
  public _id!: string;
}
