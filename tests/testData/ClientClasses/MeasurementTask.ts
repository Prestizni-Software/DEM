import {
  Priority,
  TaskStatus,
  MongoId,
  MeasuringMachine,
} from "@/backend/types";
import {
  classRef,
  classProp,
  populatedRef,
} from "@prestizni-software/client-dem/dist/CommonTypes";

import { Subordinate } from "./Subordinate";
import { Attachment } from "./Attachment";
import { Comments } from "./Comments";
import { ProtocolTask } from "./ProtocolTask";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";

type MeasuringApparatus = MeasuringMachine;

export class MeasurementTask extends AutoUpdatedClientObject<any> {
  @populatedRef("ProtocolTask:measurements")
  @classProp
  parent: ProtocolTask;

  @classProp
  public _id: MongoId;

  @classProp
  priority: Priority;

  @classProp
  visitWanted: boolean = false;

  @classProp
  tableEntry?: number;

  @classProp
  folderName?: string;

  @classProp
  whenCreated: Date;

  @classProp
  whenMeasured?: Date;

  @classProp
  note?: string | null;

  @classProp
  @classRef()
  assignedTo?: Subordinate | null;

  @classProp
  @classRef()
  attachments: Attachment[];

  @classProp
  @classRef()
  createdBy: Subordinate;

  @classProp
  measuringApparatus?: MeasuringApparatus | null; //Accepted -> Waiting for data

  //Accepted -> Waiting for data
  @classProp
  deadline?: number | null;

  @classProp
  @classRef()
  comments: Comments[];

  @classProp
  status: TaskStatus;
  
  @classProp
  lastUpdate: number = Date.now();
}
