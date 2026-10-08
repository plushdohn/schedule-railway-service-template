import { control } from "./control.ts";

if (import.meta.main) {
  try {
    console.log(JSON.stringify({ action: "stop", result: await control("stop", process.env) }));
  } catch (error) {
    console.error(JSON.stringify({ action: "stop", error: error instanceof Error ? error.message : "Function failed" }));
    process.exitCode = 1;
  }
}
