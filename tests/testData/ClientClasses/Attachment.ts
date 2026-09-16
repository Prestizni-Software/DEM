import {
  classProp,
  classRef,
  populatedRef,
} from "../../../CommonTypes.js";
import { Subordinate } from "./Subordinate.js";
import type { GeoAttachmentType, MongoId } from "./enums.js";
import { Protocol } from "./Protocol.js";
import { MeasurementTask } from "./MeasurementTask.js";
import { ProtocolTask } from "./ProtocolTask.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";

type FileType = GeoAttachmentType;
export class Attachment extends AutoUpdatedClientObject<Attachment> {
  @classProp
  public _id!: MongoId;

  @classProp
  public path!: string;

  @classProp
  public fileName!: string;

  @classProp
  @classRef()
  public creator!: Subordinate;

  @classProp
  public lastEdited!: Date;

  @classProp
  public size!: number;

  @classProp
  public type!: FileType;

  @classProp
  public createdAt!: Date;

  @classProp
  @populatedRef("Protocol:protocol")
  public protocolParent?: Protocol;

  @classProp
  @populatedRef("MeasurementTask:attachments")
  public measurementTaskParent?: MeasurementTask;

  @classProp
  @populatedRef("Protocol:word_protocol")
  public wordProtocolParent?: Protocol;

  @classProp
  @populatedRef("ProtocolTask:attachments")
  protocolTaskParent?: ProtocolTask;
}


