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

// Non-existent key on client must return type 'never'
const clientNonExistent = e.getValue("nonExistent");
type IsClientNever = [typeof clientNonExistent] extends [never] ? true : false;
const assertClientNever: true = true as IsClientNever;

// --- SERVER TESTS ---
const se = serverManagers.Test.objectsAsArray[0];

// @ts-expect-error - invalid value type on server (boolean expected)
await se.setValue("active", "true");

// @ts-expect-error - non-existent key on server (never expected for val)
await se.setValue("nonExistent", 123);

// Correct usage on server - should NOT have error
await se.setValue("active", true);
await se.setValue("parent", null);

const serverStatus = se.getValue("status");
// @ts-expect-error - see type of status (should be Status enum)
const checkServerStatus: never = serverStatus;

// Non-existent key on server must return type 'never'
const serverNonExistent = se.getValue("nonExistent");
type IsServerNever = [typeof serverNonExistent] extends [never] ? true : false;
const assertServerNever: true = true as IsServerNever;

const shouldBeTrue : typeof e = e.parentManager.objectsAsArray[0];
type AnnihilateAny<T> = 0 extends (1 & T) ? unknown : T;
const managers2 = e.parentManager.managers;

//const shouldAlsoBeTrue : typeof clientManagers = managers2 as AnnihilateAny<typeof managers2>;
