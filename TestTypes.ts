import { prop, Ref } from "@typegoose/typegoose";
import { classProp, classRef } from "./CommonTypes.js";
import { ObjectId } from "mongodb";
export enum Status {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export type Objekt = {
  _id: string;
  obj: Objekt2
}

export type Objekt2 = {
  _id: string;
}

export class Test {
  @classProp
  public _id!: string | ObjectId;

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
  @classProp @classRef("Test")
  public ref!: Ref<Test> | null;

  @prop({ required: false })
  @classProp
  public obj!:Objekt | null
}