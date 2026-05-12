import { MongoId, AssignmentType, Section } from "@/backend/types";
import {
  classProp,
  classRef,
} from "@prestizni-software/client-dem/dist/CommonTypes";
import { ConstructionObject } from "./ConstructionObject";
import { MeasurementType } from "./MeasurementTypes";
import { Protocol } from "./Protocol";
import { Subordinate } from "./Subordinate";
import { MeasurementTask } from "./MeasurementTask";
import { Attachment } from "./Attachment";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";

export class ProtocolTask extends AutoUpdatedClientObject<any> {
  @classProp
  public _id: MongoId;

  @classProp
  element: string;

  @classProp
  isAVAG: boolean = false;

  @classProp
  isTakenOver: boolean = false;

  @classProp
  @classRef()
  constructionObject: ConstructionObject;

  @classProp
  section?: Section;

  @classProp
  tableEntry?: number;

  @classProp
  folderName?: string;

  @classProp
  whenCreated: Date;

  @classProp
  @classRef()
  createdBy: Subordinate;

  @classProp
  assignmentType: AssignmentType; // Creation

  // Creation
  @classProp
  @classRef()
  measurementTypes: MeasurementType[];

  // Creation
  @classProp
  protocoling: string[]; //Creation

  @classProp
  @classRef()
  attachments: Attachment[];

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
  complex: boolean;

  @classProp
  @classRef()
  measurements: MeasurementTask[];
}
