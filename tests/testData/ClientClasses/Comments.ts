import { MongoId } from "@/backend/types";
import {
  classProp,
  classRef,
  populatedRef,
} from "@prestizni-software/client-dem/dist/CommonTypes";
import { Subordinate } from "./Subordinate";
import { MeasurementTask } from "./MeasurementTask";
import { Protocol } from "./Protocol";
import { AutoUpdatedClientObject } from "@prestizni-software/client-dem/dist/AutoUpdatedClientObjectClass";

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
