import { expect, test } from "bun:test";
import { createTemplate } from "../scripts/template.ts";

test("template creation rejects a read-back that changed required environment variables", async () => {
  const { registerTemplate } = await import("../scripts/create-template.ts");
  const config = createTemplate({ start: "start", stop: "stop" });
  const changed = structuredClone(config);
  Object.values(changed.services)[0]!.variables.TARGET_SERVICE_ID!.isOptional = true;
  let calls = 0;
  await expect(registerTemplate(config, "token", "workspace", async () => Response.json({ data: ++calls === 1
    ? { templateCreateV2: { id: "id", code: "code" } }
    : { template: { id: "id", code: "code", serializedConfig: changed } } }))).rejects.toThrow("read-back verification failed");
});

test("template creation reads back the exact remote template before returning its link", async () => {
  const { registerTemplate } = await import("../scripts/create-template.ts");
  const config = createTemplate({ start: "start", stop: "stop" });
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const result = await registerTemplate(config, "workspace-token", "4fa8a608-38c8-41b3-a498-26d44c8820fc", async (_url, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer workspace-token");
    const request = JSON.parse(String(init?.body));
    calls.push(request);
    return Response.json({ data: calls.length === 1
      ? { templateCreateV2: { id: "template-id", code: "template-code", name: "Scheduled Railway Service" } }
      : { template: { id: "template-id", code: "template-code", serializedConfig: config } } });
  });
  expect(calls).toHaveLength(2);
  expect(calls[0]?.query).toContain("templateCreateV2");
  expect(calls[0]?.variables.input).toEqual({ workspaceId: "4fa8a608-38c8-41b3-a498-26d44c8820fc", metadata: { name: "Scheduled Railway Service" }, serializedConfig: config });
  expect(calls[1]?.variables).toEqual({ id: "template-id" });
  expect(result).toEqual({ id: "template-id", code: "template-code", url: "https://railway.com/deploy/template-code" });
});
