import { expect, test } from "bun:test";
import { buildTemplate, createTemplate } from "../scripts/template.ts";

const fixtureSources = { start: "start", stop: "stop" };

test.each(["0 8 ? * *", "0 8 L * *", "0 8 * * MON"])("rejects %s outside the numeric five-field subset", cron => {
  expect(() => createTemplate(fixtureSources, { startCron: cron })).toThrow("numeric five-field");
});

test.each([
  "* * * * *", "*/7 * * * *", "0,4 8 * * *",
  "1,58 23,0 * * *", "1,58 23,0 28,1 2,3 *",
  "1,58 23,0 31,1 12,1 *", "3,59 23,0 * * 1,2",
])("rejects %s when any pair of runs is less than five minutes apart", cron => {
  expect(() => createTemplate(fixtureSources, { startCron: cron })).toThrow("five minutes");
  expect(() => createTemplate(fixtureSources, { stopCron: cron })).toThrow("five minutes");
});

test.each(["*/5 * * * *", "*/7 8 * * *", "1,58 23,0 * * 1", "0 8 * * 1-5"])("accepts %s when all runs are at least five minutes apart", cron => {
  const template = createTemplate(fixtureSources, { startCron: cron });
  expect(Object.values(template.services)[0]!.deploy.cronSchedule).toBe(cron);
});
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("both bundled Functions execute independently against a local HTTP API fixture and exit", async () => {
  await buildTemplate();
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
    const body = await request.json() as { query: string };
    requests.push(body.query);
    if (body.query.includes("query Target")) {
      return Response.json({ data: { serviceInstance: {
        latestDeployment: null,
        activeDeployments: requests.length === 1 ? [] : [{ id: "running", status: "SUCCESS", deploymentStopped: false }],
      } } });
    }
    return Response.json({ data: body.query.includes("mutation Start") ? { serviceInstanceDeployV2: "new" } : { deploymentStop: true } });
  } });
  const dir = await mkdtemp(join(tmpdir(), "railway-function-test-"));
  try {
    const preload = join(dir, "fixture.ts");
    await Bun.write(preload, `const original = globalThis.fetch; globalThis.fetch = (url, init) => { if (String(url) !== 'https://backboard.railway.com/graphql/v2') throw Error('Unexpected API URL'); return original(${JSON.stringify(server.url.toString())}, init); };`);
    for (const action of ["start", "stop"]) {
      const child = Bun.spawn([process.execPath, "--preload", preload, join(import.meta.dir, "..", "functions", `${action}.js`)], {
        env: { TARGET_SERVICE_ID: "4fa8a608-38c8-41b3-a498-26d44c8820fc", TARGET_ENVIRONMENT_ID: "140b2fe9-4ce6-4964-aa92-51f0482e0a0f", RAILWAY_PROJECT_TOKEN: "fixture-only" },
        stdout: "pipe", stderr: "pipe",
      });
      const stdout = await new Response(child.stdout).text();
      const stderr = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain(`${action} requested`);
    }
    expect(requests).toHaveLength(4);
  } finally {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});

test("template embeds exactly two independent native Functions with UTC schedules and no credentials", async () => {
  const { createTemplate } = await import("../scripts/template.ts");
  const template = createTemplate({ start: "console.log('start');", stop: "console.log('stop');" });
  expect(Object.keys(template).sort()).toEqual(["buckets", "services"]);
  const services = Object.values(template.services);
  expect(services.map(s => s.name)).toEqual(["start-target", "stop-target"]);
  expect(services.map(s => s.deploy.cronSchedule)).toEqual(["0 8 * * 1-5", "0 18 * * 1-5"]);
  for (const [index, service] of services.entries()) {
    expect(service.source.image).toBe("ghcr.io/railwayapp/function-bun:1.4.0");
    expect(service.deploy.restartPolicyType).toBe("NEVER");
    expect(service.deploy.startCommand.length).toBeLessThan(96 * 1024);
    expect(Buffer.from(service.deploy.startCommand.slice("./run.sh ".length), "base64").toString()).toBe(index === 0 ? "console.log('start');" : "console.log('stop');");
    for (const key of ["TARGET_SERVICE_ID", "TARGET_ENVIRONMENT_ID", "RAILWAY_PROJECT_TOKEN"]) {
      expect(service.variables[key]?.defaultValue).toBe(index === 0 ? "" : `\${{start-target.${key}}}`);
      expect(service.variables[key]?.isOptional).toBe(false);
    }
  }
});
