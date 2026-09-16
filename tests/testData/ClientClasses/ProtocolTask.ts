import { AssignmentType } from "./enums.js";
import type { MongoId, Section } from "./enums.js";
import {
  classProp,
  classRef,
} from "../../../CommonTypes.js";
import { ConstructionObject } from "./ConstructionObject.js";
import { MeasurementType } from "./MeasurementTypes.js";
import { Protocol } from "./Protocol.js";
import { Subordinate } from "./Subordinate.js";
import { MeasurementTask } from "./MeasurementTask.js";
import { Attachment } from "./Attachment.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";

export class ProtocolTask extends AutoUpdatedClientObject<ProtocolTask> {
  @classProp
  public _id!: MongoId;

  @classProp
  element!: string;

  @classProp
  isAVAG: boolean = false;

  @classProp
  isTakenOver: boolean = false;

  @classProp
  @classRef()
  constructionObject!: ConstructionObject;

  @classProp
  section?: Section;

  @classProp
  tableEntry?: number;

  @classProp
  folderName?: string;

  @classProp
  whenCreated!: Date;

  @classProp
  @classRef()
  createdBy!: Subordinate;

  @classProp
  assignmentType!: AssignmentType; // Creation

  // Creation
  @classProp
  @classRef()
  measurementTypes!: MeasurementType[];

  // Creation
  @classProp
  protocoling!: string[]; //Creation

  @classProp
  @classRef()
  attachments!: Attachment[];

  //Creation
  //Creation
  @classProp
  deadline?: number | null;

  @classProp
  @classRef()
  protocol?: Protocol;

  @classProp
  @classRef()
  controlProtocol?: Protocol;

  @classProp
  complex!: boolean;

  @classProp
  @classRef()
  measurements!: MeasurementTask[];
}
