import { ApprovementStatus, MongoId, ProtocolStatus } from "@/backend/types";
import {
  classProp,
  classRef,
  populatedRef,
} from "@prestizni-software/client-dem/dist/CommonTypes";
import { Attachment } from "./Attachment";
import { Comments } from "./Comments";
import { ProtocolTask } from "./ProtocolTask";
import { Subordinate } from "./Subordinate";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";

export class Protocol extends AutoUpdatedClientObject<any> {
  @classProp
  public _id: MongoId;

  @classProp
  isControl: boolean;

  @classProp
  status: ProtocolStatus;

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
  comments: Comments[];

  @classProp
  @classRef()
  supervisor_comments: Comments[];

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
  hsvAprovement: ApprovementStatus;

  @classProp
  supervisorAprovement: ApprovementStatus;

  @classProp
  folderName: string;

  @classProp
  uploadedToAspehub: boolean = false;

  @classProp
  lastUpdate: number = Date.now();
}
