import { Test } from "./ClientTypes.js";
import { IAutoUpdatedClientObject, Pure } from "./CommonTypes.js";

type P = Pure<Test>;
type PK = keyof P;

const check: PK = "active";
// @ts-expect-error
const check2: PK = "getValue";
// @ts-expect-error
const check3: PK = "isLoaded";
// @ts-expect-error
const check4: PK = "className";
