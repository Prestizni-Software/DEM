import {
  Priority,
  TaskStatus,
  MeasuringMachine,
} from "./enums.js";
import type {
  MongoId,
} from "./enums.js";
import {
  classRef,
  classProp,
  populatedRef,
} from "../../../CommonTypes.js";

import { Subordinate } from "./Subordinate.js";
import { Attachment } from "./Attachment.js";
import { Comments } from "./Comments.js";
import { ProtocolTask } from "./ProtocolTask.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";

type MeasuringApparatus = MeasuringMachine;

export class MeasurementTask extends AutoUpdatedClientObject<any> {
  @populatedRef("ProtocolTask:measurements")
  @classProp
  parent!: ProtocolTask;

  @classProp
  public _id!: MongoId;

  @classProp
  priority!: Priority;

  @classProp
  visitWanted: boolean = false;

  @classProp
  tableEntry?: number;

  @classProp
  folderName?: string;

  @classProp
  whenCreated!: Date;

  @classProp
  whenMeasured?: Date;

  @classProp
  note?: string | null;

  @classProp
  @classRef()
  assignedTo?: Subordinate | null;

  @classProp
  @classRef()
  attachments!: Attachment[];

  @classProp
  @classRef()
  createdBy!: Subordinate;

  @classProp
  measuringApparatus?: MeasuringApparatus | null; //Accepted -> Waiting for data

  //Accepted -> Waiting for data
  @classProp
  deadline?: number | null;

  @classProp
  @classRef()
  comments!: Comments[];

  @classProp
  status!: TaskStatus;
  
  @classProp
  lastUpdate: number = Date.now();
}
