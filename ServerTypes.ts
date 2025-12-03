
import { Objekt, Status } from "./TestTypes.js";
import { classProp, classRef, populatedRef } from "./CommonTypes.js";
import { Types } from "mongoose";
import { prop, Ref } from "@typegoose/typegoose";
export class Test {
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
  @classProp @classRef()
  public ref!: Ref<Test> | null;

  @prop({ required: true, default: [] })
  @classProp @classRef()
  public refarr!: Ref<Test>[];

  @prop({ required: false })
  @classProp
  public obj!: Objekt | null;

  @classProp @populatedRef("Test:refarr")
  public parent!: Ref<Test> | null;
}

export class Test2 {
  @classProp
  public _id!: string;
}