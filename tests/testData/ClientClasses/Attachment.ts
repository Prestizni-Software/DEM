import {
  classProp,
  classRef,
  populatedRef,
} from "@prestizni-software/client-dem/dist/CommonTypes";
import { Subordinate } from "./Subordinate";
import { GeoAttachmentType, MongoId } from "@/backend/types";
import { Protocol } from "./Protocol";
import { MeasurementTask } from "./MeasurementTask";
import { ProtocolTask } from "./ProtocolTask";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";

type FileType = GeoAttachmentType;
export class Attachment extends AutoUpdatedClientObject<any> {
  @classProp
  public _id: MongoId;

  @classProp
  public path: string;

  @classProp
  public fileName: string;

  @classProp
  @classRef()
  public creator: Subordinate;

  @classProp
  public lastEdited: Date;

  @classProp
  public size: number;

  @classProp
  public type: FileType;

  @classProp
  public createdAt: Date;

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
