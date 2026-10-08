import { expect, test } from "bun:test";
import { control, type Send } from "../src/control.ts";

function fixture(active: { id: string; status: string; deploymentStopped: boolean }[] = [], latest: { id: string; status: string; deploymentStopped: boolean } | null = null) {
  const requests: { query: string; variables: Record<string, string> }[] = [];
  const send: Send = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ data: requests.length === 1
      ? { serviceInstance: { activeDeployments: active, latestDeployment: latest } }
      : { serviceInstanceDeployV2: "new", deploymentStop: true } });
  };
  return { requests, send };
}

test.each([
  ["HTTP", () => new Response("unauthorized", { status: 401 })],
  ["GraphQL", () => Response.json({ errors: [{ message: "test-project-token" }] })],
  ["Malformed", () => new Response("not json")],
  ["Missing", () => Response.json({ data: null })],
] as const)("%s API failures abort without leaking the token", async (_kind, response) => {
  let calls = 0;
  try {
    await control("start", env, async () => { calls++; return response(); });
    throw new Error("Expected API request to fail");
  } catch (error) {
    expect(String(error)).not.toContain(env.RAILWAY_PROJECT_TOKEN);
    expect(String(error)).toContain("Railway API");
    expect(String(error)).not.toContain("Expected API request to fail");
  }
  expect(calls).toBe(1);
});

test("stop rejects a false mutation result", async () => {
  const f = fixture([{ id: "a", status: "SUCCESS", deploymentStopped: false }]);
  const send: Send = async (url, init) => {
    const response = await f.send(url, init);
    return f.requests.length > 1 ? Response.json({ data: { deploymentStop: false } }) : response;
  };
  await expect(control("stop", env, send)).rejects.toThrow("Stop request was rejected");
});

test.each(["TARGET_SERVICE_ID", "TARGET_ENVIRONMENT_ID", "RAILWAY_PROJECT_TOKEN"])("missing %s fails before any request", async key => {
  const f = fixture();
  await expect(control("start", { ...env, [key]: "" }, f.send)).rejects.toThrow(`Missing ${key}`);
  expect(f.requests).toHaveLength(0);
});

test.each(["TARGET_SERVICE_ID", "TARGET_ENVIRONMENT_ID"])("invalid %s fails before any request", async key => {
  const f = fixture();
  await expect(control("start", { ...env, [key]: "invalid" }, f.send)).rejects.toThrow(`Invalid ${key}`);
  expect(f.requests).toHaveLength(0);
});

test("the function cannot target itself", async () => {
  const f = fixture();
  await expect(control("stop", { ...env, RAILWAY_SERVICE_ID: env.TARGET_SERVICE_ID }, f.send)).rejects.toThrow("cannot target itself");
  expect(f.requests).toHaveLength(0);
});

test.each(["QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING", "WAITING"])("start avoids duplicate %s deployment and stop refuses the race", async status => {
  const latest = { id: "pending", status, deploymentStopped: false };
  const start = fixture([], latest);
  expect(await control("start", env, start.send)).toBe("deployment already in progress");
  expect(start.requests).toHaveLength(1);
  const stop = fixture([], latest);
  await expect(control("stop", env, stop.send)).rejects.toThrow("deployment is in progress");
  expect(stop.requests).toHaveLength(1);
});

test("stop is a no-op when there are no running deployments", async () => {
  const f = fixture();
  expect(await control("stop", env, f.send)).toBe("already stopped");
  expect(f.requests).toHaveLength(1);
});

test("start rejects an empty deployment ID", async () => {
  const f = fixture();
  const send: Send = async (url, init) => {
    const response = await f.send(url, init);
    return f.requests.length > 1 ? Response.json({ data: { serviceInstanceDeployV2: null } }) : response;
  };
  await expect(control("start", env, send)).rejects.toThrow("Start request was rejected");
});

test("stop requests stopping every running deployment, never starting the service", async () => {
  const f = fixture([
    { id: "a", status: "SUCCESS", deploymentStopped: false },
    { id: "b", status: "SUCCESS", deploymentStopped: false },
    { id: "old", status: "SUCCESS", deploymentStopped: true },
  ]);
  expect(await control("stop", env, f.send)).toBe("stop requested for 2 deployment(s)");
  expect(f.requests.slice(1).map(r => r.variables)).toEqual([{ id: "a" }, { id: "b" }]);
  expect(f.requests.slice(1).every(r => r.query.includes("deploymentStop"))).toBe(true);
});

test("start is a no-op when the target is running", async () => {
  const f = fixture([{ id: "running", status: "SUCCESS", deploymentStopped: false }]);
  expect(await control("start", env, f.send)).toBe("already running");
  expect(f.requests).toHaveLength(1);
});

const env = {
  TARGET_SERVICE_ID: "4fa8a608-38c8-41b3-a498-26d44c8820fc",
  TARGET_ENVIRONMENT_ID: "140b2fe9-4ce6-4964-aa92-51f0482e0a0f",
  RAILWAY_PROJECT_TOKEN: "test-project-token",
};

test("start deploys an idle target using its service and environment, not a removed deployment", async () => {
  const { control } = await import("../src/control.ts");
  const requests: { query: string; variables: Record<string, string> }[] = [];
  const send = async (url: string | URL | Request, init?: RequestInit) => {
    expect(url).toBe("https://backboard.railway.com/graphql/v2");
    expect(new Headers(init?.headers).get("Project-Access-Token")).toBe(env.RAILWAY_PROJECT_TOKEN);
    requests.push(JSON.parse(String(init?.body)));
    const data = requests.length === 1
      ? { serviceInstance: { activeDeployments: [], latestDeployment: { id: "removed", status: "REMOVED", deploymentStopped: true } } }
      : { serviceInstanceDeployV2: "new-deployment" };
    return Response.json({ data });
  };
  expect(await control("start", env, send)).toBe("start requested");
  expect(requests).toHaveLength(2);
  expect(requests[1]?.query).toContain("serviceInstanceDeployV2");
  expect(requests[1]?.variables).toEqual({ serviceId: env.TARGET_SERVICE_ID, environmentId: env.TARGET_ENVIRONMENT_ID });
});
