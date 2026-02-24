import { Objekt, Status } from "./TestTypes.js";
import { classProp, classRef, populatedRef } from "./CommonTypes.js";
import { Types } from "mongoose";
import { prop, Ref } from "@typegoose/typegoose";
import { AutoUpdatedServerObject } from "./AutoUpdatedServerObjectClass.js";
export class Test extends AutoUpdatedServerObject<any> {
  @classProp
  public _id!: Types.ObjectId;

  @prop({ required: true })
  @classProp
  public active!: boolean;

  @prop({ required: true })
  @classProp
  public status!: Status;

  @prop({ required: false })
  @classProp
  public description!: string | null;

  @prop({ required: false })
  @classProp
  @classRef()
  public ref!: Test | null;

  @prop({ required: true, default: [] })
  @classProp
  @classRef()
  public refarr!: Test[];

  @prop({ required: false })
  @classProp
  public obj!: Objekt | null;

  @classProp
  @populatedRef("Test:refarr")
  public parent!: Test | null;
}

export class Test2 extends AutoUpdatedServerObject<any> {
  @classProp
  public _id!: string;
}
