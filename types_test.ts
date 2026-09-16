import { initClientManagers, initServerManagers } from "./test_lib.js";

const clientManagers = (await initClientManagers("")).managers;
const serverManagers = (await initServerManagers()).managers;

const e = clientManagers.Test.objectsAsArray[0];

// --- EXTRACTED DATA TEST ---
const data = e.extractedData;
// @ts-expect-error - see type of extractedData
const checkExtracted: never = data;

e.className;
// --- SET VALUE TEST ---
// @ts-expect-error - invalid value type (boolean expected)
await e.setValue("active", "true");

// @ts-expect-error - non-existent key (never expected for val)
await e.setValue("nonExistent", 123);

// Correct usage - should NOT have error
await e.setValue("active", true);

// --- GET VALUE TEST ---
const status = e.getValue("status");
// @ts-expect-error - see type of status (should be Status enum)
const checkStatus: never = status;

const ref = e.getValue("ref");
// @ts-expect-error - see type of ref (should be Test | null)
const checkRef: never = ref;

const refId = e.getValue("ref._id");
// @ts-expect-error - see type of ref._id (should be ObjectId)
const checkRefId: never = refId;

const shouldBeTrue : typeof e = e.parentManager.objectsAsArray[0];
type AnnihilateAny<T> = 0 extends (1 & T) ? unknown : T;
const managers2 = e.parentManager.managers;

//const shouldAlsoBeTrue : typeof clientManagers = managers2 as AnnihilateAny<typeof managers2>;
