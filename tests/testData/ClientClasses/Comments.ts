import { MongoId } from "./enums.js";
import {
  classProp,
  classRef,
  populatedRef,
} from "../../../CommonTypes.js";
import { Subordinate } from "./Subordinate.js";
import { MeasurementTask } from "./MeasurementTask.js";
import { Protocol } from "./Protocol.js";
import { AutoUpdatedClientObject } from "../../../AutoUpdatedClientObjectClass.js";

export class Comments extends AutoUpdatedClientObject<any> {
  @classProp
  _id: MongoId;

  @classProp
  when: number;

  @classProp
  what: string;

  @classProp
  status: string;

  @classProp
  @classRef()
  who: Subordinate;

  @classProp
  @classRef()
  mentions: Subordinate[];

  @classProp
  isSystemMessage: boolean;

  @classProp
  @populatedRef("Protocol:comments")
  public rootTaskParent?: Protocol;

  @classProp
  @populatedRef("Protocol:supervisor_comments")
  public rootTaskSupervisorParent?: Protocol;

  @classProp
  @populatedRef("MeasurementTask:comments")
  public nodeTaskParent?: MeasurementTask;
}


