import { ApprovementStatus, ProtocolStatus } from "./enums.js";
import type { MongoId } from "./enums.js";
import {
  classProp,
  classRef,
  populatedRef,
} from "../../../CommonTypes.js";
import { Attachment } from "./Attachment.js";
import { Comments } from "./Comments.js";
import { ProtocolTask } from "./ProtocolTask.js";
import { Subordinate } from "./Subordinate.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";

export class Protocol extends AutoUpdatedClientObject<any> {
  @classProp
  public _id!: MongoId;

  @classProp
  isControl!: boolean;

  @classProp
  status!: ProtocolStatus;

  @classProp
  @classRef()
  protocol?: Attachment;

  @classProp
  @classRef()
  word_protocol?: Attachment;

  @classProp
  protocolNumber?: number;

  @classProp
  @classRef()
  comments!: Comments[];

  @classProp
  @classRef()
  supervisor_comments!: Comments[];

  @classProp
  @classRef()
  @populatedRef("ProtocolTask:protocol")
  protocolTask?: ProtocolTask;

  @classProp
  @classRef()
  @populatedRef("ProtocolTask:controlProtocol")
  protocolTask_control?: ProtocolTask;

  @classProp
  @classRef()
  assignedKK?: Subordinate;

  @classProp
  whenAssigned?: Date;

  @classProp
  hsvAprovement!: ApprovementStatus;

  @classProp
  supervisorAprovement!: ApprovementStatus;

  @classProp
  folderName!: string;

  @classProp
  uploadedToAspehub: boolean = false;

  @classProp
  lastUpdate: number = Date.now();
}
