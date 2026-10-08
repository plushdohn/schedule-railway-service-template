import { CronPattern } from "croner";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const RUNTIME_IMAGE = "ghcr.io/railwayapp/function-bun:1.4.0";
export type TemplateOptions = { startCron?: string; stopCron?: string };
export type TemplateService = {
  name: string;
  source: { image: string };
  deploy: { startCommand: string; cronSchedule: string; restartPolicyType: "NEVER" };
  variables: Record<string, { isOptional: boolean; description: string; defaultValue: string }>;
};
export type Template = { buckets: Record<string, never>; services: Record<string, TemplateService> };

export function validateSchedule(cron: string): void {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5 || fields.some(field => !/^[0-9*,/\-]+$/.test(field))) {
    throw new Error("Use a numeric five-field cron expression (numbers, *, lists, ranges and steps)");
  }
  const pattern = new CronPattern(cron, "UTC", { mode: "5-part" });
  const times: number[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute++) {
      if (pattern.hour[hour] && pattern.minute[minute]) times.push(hour * 60 + minute);
    }
  }
  const tooClose = () => { throw new Error("Railway cron runs must be at least five minutes apart, including hour/day boundaries"); };
  for (let index = 1; index < times.length; index++) {
    if (times[index]! - times[index - 1]! < 5) tooClose();
  }
  if (!times.length || 1440 + times[0]! - times[times.length - 1]! >= 5) return;
  // Only midnight can still violate the minimum. Check whether the calendar
  // selects consecutive dates across the entire Gregorian/weekday cycle,
  // including leap years and the end-to-start boundary, not a future sample.
  const end = Date.UTC(2400, 0, 1);
  let previousMatches = false;
  for (const date = new Date(Date.UTC(2000, 0, 1)); date.getTime() <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const dom = Boolean(pattern.day[date.getUTCDate() - 1]);
    const dow = Boolean(pattern.dayOfWeek[date.getUTCDay()]);
    const dayMatches = pattern.starDOM ? dow : pattern.starDOW ? dom : dom || dow;
    const matches = Boolean(pattern.month[date.getUTCMonth()]) && dayMatches;
    if (matches && previousMatches) tooClose();
    previousMatches = matches;
  }
}

export function createTemplate(sources: { start: string; stop: string }, options: TemplateOptions = {}): Template {
  const services: Record<string, TemplateService> = {};
  const definitions = [
    { action: "start" as const, id: "4fa8a608-38c8-41b3-a498-26d44c8820fc", cron: options.startCron ?? "0 8 * * 1-5" },
    { action: "stop" as const, id: "140b2fe9-4ce6-4964-aa92-51f0482e0a0f", cron: options.stopCron ?? "0 18 * * 1-5" },
  ];
  for (const { action, id, cron } of definitions) {
    validateSchedule(cron);
    const startCommand = `./run.sh ${Buffer.from(sources[action]).toString("base64")}`;
    if (startCommand.length >= 96 * 1024) throw new Error("Function exceeds Railway's 96 KiB encoded command limit");
    services[id] = {
      name: `${action}-target`,
      source: { image: RUNTIME_IMAGE },
      deploy: { startCommand, cronSchedule: cron, restartPolicyType: "NEVER" },
      variables: {
        TARGET_SERVICE_ID: { isOptional: false, description: "UUID of the existing service to control (not this Function)", defaultValue: "" },
        TARGET_ENVIRONMENT_ID: { isOptional: false, description: "UUID of the target service's environment", defaultValue: "" },
        RAILWAY_PROJECT_TOKEN: { isOptional: false, description: "Railway Project Token scoped to the target project's environment", defaultValue: "" },
      },
    };
    for (const [key, variable] of Object.entries(services[id]!.variables)) {
      if (action === "stop") variable.defaultValue = `\${{start-target.${key}}}`;
    }
  }
  return { buckets: {}, services };
}

export async function buildTemplate(options: TemplateOptions = {}) {
  const root = join(import.meta.dir, "..");
  await mkdir(join(root, "functions"), { recursive: true });
  const sources = { start: "", stop: "" };
  for (const action of ["start", "stop"] as const) {
    const result = await Bun.build({ entrypoints: [join(root, "src", `${action}.ts`)], target: "bun", format: "esm", minify: false });
    if (!result.success) throw new Error(`Failed to bundle ${action}: ${result.logs.join("; ")}`);
    sources[action] = await result.outputs[0]!.text();
  }
  // Validate the complete configuration before replacing any generated artifact.
  const template = createTemplate(sources, options);
  for (const action of ["start", "stop"] as const) await Bun.write(join(root, "functions", `${action}.js`), sources[action]);
  await Bun.write(join(root, "template.json"), JSON.stringify(template, null, 2) + "\n");
  return template;
}

if (import.meta.main) {
  await buildTemplate({ startCron: process.env.START_CRON_SCHEDULE, stopCron: process.env.STOP_CRON_SCHEDULE });
  console.log("Built two standalone Railway Functions and template.json");
}
