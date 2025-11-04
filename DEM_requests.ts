import { Paths } from "./CommonTypes.js"
import { Test } from "./server.js"

type AutoStatusOptions<T> = {
  statusVariable: Paths<T>
}

const example_auto_status_options:AutoStatusOptions<typeof Test.prototype> = {
  statusVariable: "status",

}

/*
 *  
 *
*/