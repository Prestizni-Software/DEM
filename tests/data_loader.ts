import fs from "node:fs";
import path from "node:path";
import { getModelForClass } from "@typegoose/typegoose";
import * as ServerClasses from "./testData/ServerClasses/index.js";

const mapping: Record<string, any> = {
  "attachments.json": ServerClasses.Attachment,
  "comments.json": ServerClasses.Comments,
  "companies.json": ServerClasses.Company,
  "constructionobjects.json": ServerClasses.ConstructionObject,
  "constructions.json": ServerClasses.Construction,
  "elements.json": ServerClasses.Element,
  "measurementtasks.json": ServerClasses.MeasurementTask,
  "measurementtypes.json": ServerClasses.MeasurementType,
  "protocols.json": ServerClasses.Protocol,
  "protocoltasks.json": ServerClasses.ProtocolTask,
  "subordinates.json": ServerClasses.Subordinate,
};

export async function loadTestData() {
  const dataDir = path.join(process.cwd(), "tests", "testData");
  
  for (const [file, cls] of Object.entries(mapping)) {
    const filePath = path.join(dataDir, file);
    if (fs.existsSync(filePath)) {
      const rawData = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(rawData);
      
      // Convert $oid and $date to proper MongoDB/JS types if necessary
      // Actually, Mongoose/Typegoose might handle some of this, 
      // but JSON.parse doesn't know about ObjectId.
      const processedData = processMongoJSON(data);
      
      const model = getModelForClass(cls);
      await model.deleteMany({});
      await model.insertMany(processedData);
    }
  }
}

function processMongoJSON(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(processMongoJSON);
  } else if (obj !== null && typeof obj === "object") {
    if (obj.$oid) {
      return obj.$oid;
    } else if (obj.$date) {
      return new Date(obj.$date);
    }
    const newObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
      newObj[key] = processMongoJSON(value);
    }
    return newObj;
  }
  return obj;
}
