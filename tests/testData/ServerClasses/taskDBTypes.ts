import { modelOptions, prop, Severity } from "@typegoose/typegoose";
import { Attachment, Comments, ConstructionObject, Section, MeasurementType, Subordinate } from "./dbTypes.js";
import { AssignmentType, MeasuringApparatus, Priority, ProtocolStatus, TaskStatus } from "./enums.js";
import { Types } from "mongoose";
import { classProp, classRef, populatedRef } from "../../../CommonTypes.js";
import { AutoUpdatedServerObject } from "../../../AutoUpdatedServerObjectClass.js";

export enum ApprovementStatus {
    TO_BE_DETERMINED = -1,
    NOT_APPROVED = 0,
    APPROVED = 1,
}
@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
})
export class ProtocolTask extends AutoUpdatedServerObject<ProtocolTask> {
    @classProp
    public _id!: Types.ObjectId;

    @classProp
    @prop({ required: true, type: () => String })
    element!: string;

    @classProp
    @prop({ required: true, type: () => Boolean })
    complex!: boolean;

    @classProp
    @prop({ required: true, type: () => Boolean, default: false })
    isAVAG!: boolean;

    @classProp
    @prop({ required: true, type: () => Boolean, default: false })
    isTakenOver: boolean = false;

    @classProp
    @classRef()
    @prop({ required: true, ref: () => ConstructionObject })
    constructionObject!: ConstructionObject;

    @classProp
    @prop({ required: false, type: () => Section })
    section?: Section;

    @classProp
    @prop({ required: false, type: () => Number })
    tableEntry?: number;

    @classProp
    @prop({ required: false, type: () => String })
    folderName?: string;

    @classProp
    @prop({ required: true, type: () => Date, default: new Date() })
    whenCreated!: Date;

    @classProp
    @classRef()
    @prop({ required: true, ref: () => Subordinate, type: () => Subordinate })
    createdBy!: Subordinate;

    @classProp
    @classRef()
    @prop({ required: true, ref: () => Attachment, type: () => [Attachment] })
    attachments!: Attachment[];

    @classProp
    @prop({ required: true, enum: AssignmentType, type: () => Number })
    assignmentType!: AssignmentType; // Creation

    // Creation
    @classProp
    @prop({ required: true, type: () => [String], default: [] })
    protocoling!: string[]; //Creation

    //Creation
    @classProp
    @prop({ required: false, type: () => Number, default: null })
    deadline?: number | null;

    @classProp
    @classRef()
    @prop({ required: true, type: () => [MeasurementType], ref: () => MeasurementType, default: [] })
    measurementTypes!: MeasurementType[];

    @classProp
    @classRef()
    @prop({ required: true, type: () => [MeasurementTask], ref: () => MeasurementTask, default: [] })
    measurements!: MeasurementTask[];

    @classProp
    @classRef()
    @prop({ required: false, type: () => Protocol, ref: () => Protocol })
    protocol?: Protocol;

    @classProp
    @classRef()
    @prop({ required: false, type: () => Protocol, ref: () => Protocol })
    controlProtocol?: Protocol;
}

@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
})
export class MeasurementTask extends AutoUpdatedServerObject<MeasurementTask> {
    @populatedRef("ProtocolTask:measurements")
    @classProp
    parent?: ProtocolTask;

    @classProp
    public _id!: Types.ObjectId;

    @classProp
    @prop({ required: true, type: () => Boolean, default: false })
    visitWanted: boolean = false;

    @classProp
    @prop({ required: true, default: Priority.LOW, type: () => String })
    priority!: Priority;

    @classProp
    @prop({ required: false, type: () => Number })
    tableEntry?: number;

    @classProp
    @prop({ required: false, type: () => String })
    folderName?: string;

    @classProp
    @prop({ required: true, type: () => Number, default: Date.now() })
    lastUpdate: number = Date.now();

    @classProp
    @prop({ required: true, type: () => Date, default: new Date() })
    whenCreated!: Date;

    @classProp
    @prop({ required: false, type: () => Date })
    whenMeasured?: Date;

    @classProp
    @prop({ required: false, type: () => String })
    note?: string | null;

    @classProp
    @classRef()
    @prop({ ref: () => Subordinate, default: null, type: () => Subordinate })
    assignedTo?: Subordinate | null;

    @classProp
    @classRef()
    @prop({ ref: () => Attachment, default: [], type: () => [Attachment] })
    attachments!: Attachment[];

    @classProp
    @classRef()
    @prop({ required: true, ref: () => Subordinate, type: () => Subordinate })
    createdBy!: Subordinate;

    @classProp
    @prop({
        required: false,
        enum: MeasuringApparatus,
        default: null,
        type: () => String,
    })
    measuringApparatus?: MeasuringApparatus | null; //Accepted -> Waiting for data

    //Accepted -> Waiting for data
    @classProp
    @prop({ required: false, type: () => Number, default: null })
    deadline?: number | null;

    @classProp
    @classRef()
    @prop({ required: true, ref: () => Comments, default: [], type: () => [Comments] })
    comments!: Comments[];

    @classProp
    @prop({
        required: true,
        enum: TaskStatus,
        default: TaskStatus.WAITING,
        type: () => String,
    })
    status!: TaskStatus;
}

@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
})
export class Protocol extends AutoUpdatedServerObject<Protocol> {
    @classProp
    public _id!: Types.ObjectId;

    @classProp
    @prop({ required: true, type: () => Boolean, default: false })
    isControl!: boolean;

    @classProp
    @prop({ required: false, type: () => Number })
    protocolNumber?: number;

    @classProp
    @prop({ required: false, type: () => String })
    folderName?: string;

    @classProp
    @prop({ required: true, type: () => String, enum: ProtocolStatus, default: ProtocolStatus.WAITING_FOR_MEASUREMENTS })
    status!: ProtocolStatus;

    @classProp
    @classRef()
    @prop({ default: null, ref: () => Attachment, type: () => Attachment })
    protocol?: Attachment;

    @classProp
    @classRef()
    @prop({ default: null, ref: () => Attachment, type: () => Attachment })
    word_protocol?: Attachment;

    @classProp
    @classRef()
    @prop({ required: true, ref: () => Comments, default: [], type: () => [Comments] })
    comments!: Comments[];

    @classProp
    @prop({ required: true, type: () => Number, default: Date.now() })
    lastUpdate: number = Date.now();

    @classProp
    @classRef()
    @prop({ required: true, ref: () => Comments, default: [], type: () => [Comments] })
    supervisor_comments!: Comments[];

    @classProp
    @classRef()
    @prop({ required: false, type: () => Subordinate, ref: () => Subordinate })
    assignedKK?: Subordinate;

    @classProp
    @prop({ required: false, type: () => Date, default: new Date() })
    whenAssigned?: Date;

    @classProp
    @prop({ required: true, type: () => Number, enum: ApprovementStatus, default: ApprovementStatus.TO_BE_DETERMINED })
    hsvAprovement!: ApprovementStatus;

    @classProp
    @prop({ required: true, type: () => Number, enum: ApprovementStatus, default: ApprovementStatus.TO_BE_DETERMINED })
    supervisorAprovement!: ApprovementStatus;

    @classProp
    @prop({ required: true, type: () => Boolean, default: false })
    uploadedToAspehub!: boolean;

    @classProp
    @populatedRef("ProtocolTask:protocol")
    protocolTask?: ProtocolTask;

    @classProp
    @populatedRef("ProtocolTask:controlProtocol")
    protocolTask_control?: ProtocolTask;
}
