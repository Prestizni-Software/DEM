import { ObjectId } from "mongoose";
import { AUSManagerFactory } from "./AutoUpdateServerManagerClass.ts";

class Test {
    _id!: ObjectId
}

const managers = await AUSManagerFactory({

})