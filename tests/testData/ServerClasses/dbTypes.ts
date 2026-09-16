import { prop, modelOptions, pre, Severity } from "@typegoose/typegoose";
import "reflect-metadata";
import { ObjectId } from "mongodb";
import { classProp, classRef, populatedRef } from "../../../CommonTypes.js";
import { SubordinateType, FileType } from "./enums.js";
import { MeasurementTask, Protocol, ProtocolTask } from "./taskDBTypes.js";
import { AutoUpdatedServerObject } from "../../../AutoUpdatedServerObjectClass.js";

@modelOptions({
    schemaOptions: {
        discriminatorKey: "type",
    },
    options: {
        allowMixed: Severity.ALLOW,
    },
})
// Pre to sync login changes with UserModel
@pre<typeof Subordinate>("findOneAndUpdate", async function (this) {
    // 'this' is a Query in query middleware
    const update = (this as any).getUpdate();
    if (update?.login) {
        const doc = await (this as any).model.findOne((this as any).getQuery());
        if (doc && doc.login !== update.login) {
            //TODO: fix circular dependency
            //await getModelForClass(User).updateOne({ login: doc.login }, { login: update.login });
        }
    }
})
export class Subordinate extends AutoUpdatedServerObject<Subordinate> {
    @classProp
    public _id!: ObjectId;

    @classProp
    @prop({ required: true, type: () => String })
    public login!: string;

    @classProp
    @prop({ required: true, type: () => String })
    public name!: string;

    @classProp
    @prop({ required: true, type: () => String })
    public phone!: string;

    @classProp
    @prop({ required: true, type: () => String, enum: SubordinateType })
    public type!: SubordinateType;

    @classRef()
    @classProp
    @prop({ required: true, type: () => [Company], ref: () => Company, default: [] })
    public company?: Company[]; //SV má vždy max jednu a geodet jich může mít více

    @classProp
    @classRef()
    @prop({ required: false, type: () => Construction, ref: () => Construction })
    public onSite?: Construction;
}

@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
    schemaOptions: { _id: false },
})
export class Section {
    @classProp
    @prop({ required: true, type: () => Number })
    public from!: number;

    @classProp
    @prop({ required: true, type: () => Number })
    public to!: number;
}

@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
})
export class Comments extends AutoUpdatedServerObject<Comments> {
    @classProp
    public _id!: ObjectId;

    @classProp
    @prop({ required: true, type: () => Number })
    public when!: number;

    @classProp
    @prop({ required: true, type: () => String })
    public what!: string;

    @classProp
    @prop({ required: true, type: () => String })
    public status!: string;

    @classProp
    @classRef()
    @prop({ required: true, ref: () => Subordinate })
    public who!: Subordinate;

    @classProp
    @classRef()
    @prop({ required: true, ref: () => Subordinate, type: () => [Subordinate], default: [] })
    public mentions!: Subordinate[];

    @classProp
    @prop({ required: true, type: () => Boolean, default: false })
    public isSystemMessage!: boolean;

    @classProp
    @populatedRef("Protocol:comments")
    public rootTaskParent?: ProtocolTask;

    @classProp
    @populatedRef("Protocol:supervisor_comments")
    public rootTaskSupervisorParent?: ProtocolTask;

    @classProp
    @populatedRef("MeasurementTask:comments")
    public nodeTaskParent?: MeasurementTask;
}

@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
    schemaOptions: { _id: true },
})
export class Attachment extends AutoUpdatedServerObject<Attachment> {
    @classProp
    public _id!: ObjectId;
    
    @classProp
    @prop({ required: true, type: () => String, default: "---" })
    public path!: string;

    @classProp
    @prop({ required: true, type: () => String })
    public fileName!: string;

    @classProp
    @classRef()
    @prop({ ref: () => Subordinate, type: () => Subordinate })
    public creator!: Subordinate;

    @classProp
    @prop({ required: true, type: () => Date })
    public lastEdited!: Date;

    @classProp
    @prop({required: false, type: ()=> Date, default: ()=>Date.now(), immutable: true})
    public createdAt? : Date;

    @classProp
    @prop({ required: true, enum: FileType, type: () => String})
    public type!: FileType;

    @classProp
    @prop({ required: true, type: () => Number, default: -1 })
    public size!: number;

    @classProp
    @populatedRef("Protocol:protocol")
    public protocolParent?: Protocol;

    @classProp
    @populatedRef("Protocol:word_protocol")
    public wordProtocolParent?: Protocol;

    @classProp
    @populatedRef("MeasurementTask:attachments")
    public measurementTaskParent?: MeasurementTask;
    
    @classProp
    @populatedRef("ProtocolTask:attachments")
    public protocolTaskParent?: ProtocolTask;
}

@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
})
export class Construction extends AutoUpdatedServerObject<Construction> {
    @classProp
    public _id!: ObjectId;

    @classProp
    @prop({ required: true, type: () => String })
    public name!: string;

    @classProp
    @classRef()
    @prop({
        required: true,
        type: () => [ConstructionObject],
        ref: () => ConstructionObject,
    })
    public objects!: ConstructionObject[];
}

@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
})
export class ConstructionObject extends AutoUpdatedServerObject<ConstructionObject> {
    //Stavební objekt samotný

    @classProp
    public _id!: ObjectId;

    @classProp
    @prop({ required: true, type: () => String })
    public number!: string;

    @classProp
    @prop({ required: true, type: () => String, default: "---" })
    public path!: string;

    @classProp
    @classRef()
    @prop({ required: false, type: () => Company, ref: () => Company })
    public company?: Company;

    @classProp
    @classRef()
    @prop({ ref: () => Subordinate, type: () => [Subordinate], default: [] })
    public siteManagers?: Subordinate[];

    @populatedRef("Construction:objects")
    @classProp
    @prop({ required: false, ref: () => Construction, type: () => Construction })
    public parent?: Construction;
}


@modelOptions({
    options: {
        allowMixed: Severity.ALLOW,
    },
})
export class Company extends AutoUpdatedServerObject<Company> {
    @classProp
    public _id!: ObjectId;

    @classProp
    @prop({ required: true, type: () => String })
    public fullName!: string;

    @classProp
    @prop({ required: true, type: () => String })
    public abbr!: string;
}

@modelOptions({
  options: {
    allowMixed: Severity.ALLOW,
  },
  schemaOptions: {
    _id: true
  }
})
export class MeasurementType extends AutoUpdatedServerObject<MeasurementType> {

    @classProp
    _id!: ObjectId;

    @classProp
    @prop({ required: true, type: () => String })
    name!: string;
}

@modelOptions({
  options: {
    allowMixed: Severity.ALLOW,
  },
  schemaOptions: {
    _id: true
  }
})
export class Element extends AutoUpdatedServerObject<Element> {

    @classProp
    _id!: ObjectId;

    @classProp
    @prop({ required: true, type: () => String })
    name!: string;
}
