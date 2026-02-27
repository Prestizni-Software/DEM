import { Objekt, Status } from "./TestTypes.js";
import { classProp, classRef, populatedRef } from "./CommonTypes.js";
import { Types } from "mongoose";
import { prop } from "@typegoose/typegoose";
import { AutoUpdatedServerObject } from "./AutoUpdatedServerObjectClass.js";
export class Test extends AutoUpdatedServerObject<Test> {
  @classProp
  public _id!: Types.ObjectId;

  @prop({ required: true, type: () => Boolean })
  @classProp
  public active!: boolean;

  @prop({ required: true, type: () => String, enum: Status })
  @classProp
  public status!: Status;

  @prop({ required: false, type: () => String })
  @classProp
  public description!: string | null;

  @prop({ required: false, ref: () => Test })
  @classProp
  @classRef()
  public ref!: Test | null;

  @prop({ required: true, default: [] })
  @classProp
  @classRef()
  public refarr!: Test[];

  @prop({ required: false, type: () => Object })
  @classProp
  public obj!: Objekt | null;

  @classProp
  @populatedRef("Test:refarr")
  public parent!: Test | null;
}
export class Test2 extends AutoUpdatedServerObject<Test2> {
  @classProp
  public _id!: string;
}
