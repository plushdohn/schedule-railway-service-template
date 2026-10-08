import { control } from "./control.ts";

if (import.meta.main) {
  try {
    console.log(JSON.stringify({ action: "start", result: await control("start", process.env) }));
  } catch (error) {
    console.error(JSON.stringify({ action: "start", error: error instanceof Error ? error.message : "Function failed" }));
    process.exitCode = 1;
  }
}
