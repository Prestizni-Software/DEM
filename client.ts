import { io } from "socket.io-client";
import readline from "readline";
import { classProp, classRef, LoggersType } from "./CommonTypes.js";
import { AUCManagerFactory } from "./AutoUpdateClientManagerClass.js";

class Test2 {
  @classProp public _id!: string;
  @classProp public login!: string;
  @classProp public loggers!: LoggersType;
  public func = () => {
    console.log("func");
  };
}

class Test {
  @classProp public _id!: string;
  @classProp public login!: string[];
  @classProp public loggers!: LoggersType;

  // mark as compile-time Ref<Test2> (runtime is still string id)
  @classProp @classRef public test2!: Test2;

  // force-loaded ref
  @classProp @classRef public test3!: Test2;
}
const loggers: LoggersType = {
  info: console.log,
  debug: console.debug,
  error: console.error,
  warn: console.warn,
};

const socket = io("http://localhost:3000", {
  extraHeaders: {
    //HEADRY
    Authorization: "Bearer " + "token",
  },
});
socket.on("connect", async () => {
  
  const classers = await AUCManagerFactory({ Test, Test2 }, loggers, socket);

  // ---------------------- Setup CLI ----------------------
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  setTimeout(async () => {
    const ass = ((classers).Test.getObject("68c9f23872cff1778cb1abe2"));
    ass?.test2.loggers.info("test");
    ass?.test2.func();
  }, 100);
  
  // ---------------------- Interactive CLI ----------------------
  function prompt() {
    rl.question(
      "\nCommands:\n[list] List all collections\n[show <collection> <id> <field?>] Show object\n[set <collection> <id> <field> <value>] Update field\n[new <collection>] Request new object\n[exit] Exit\n> ",
      async (input) => {
        const args = input.trim().split(" ");
        const cmd = args[0];

        switch (cmd) {
          case "list":
            console.log("Collections:");
            for (const classer of Object.values(classers)) {
              console.log(`- ${classer.className}`);
              for (const id of classer.objectIDs) {
                console.log(`   • ${id}`);
              }
            }
            break;

          case "show":
            if (args.length < 3)
              return console.log("❌ Usage: show <collection> <id> <field?>");

            const objShow = await (classers as any)[args[1]]?.getClass(args[2]);
            if (!objShow) return console.log("❌ Collection not found");

            if (args[3]) {
              const val = objShow.getValue(args[3]);
              console.log(val !== undefined ? val : "❌ Field not found");
            } else {
              console.log(objShow.extractData);
            }
            break;

          case "set":
            if (args.length < 5)
              return console.log(
                "❌ Usage: set <collection> <id> <field> <value>"
              );

            const objSet = await (classers as any)[args[1]]?.getClass(args[2]);
            if (!objSet) return console.log("❌ Object not found");

            const fieldPath = args[3];
            const value = args.slice(4).join(" "); // allow spaces in value

            if (fieldPath === "_id") return console.log("❌ Cannot change _id");

            objSet.setValue(fieldPath, value);
            console.log(`✅ Updated ${fieldPath} = ${value}`);
            break;

          case "exit":
            console.log("👋 Exiting...");
            process.exit(0);

          default:
            console.log("❌ Unknown command");
        }

        prompt();
      }
    );
  }
  prompt();
});
