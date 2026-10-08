import { expect, test } from "bun:test";
import { createTemplate } from "../scripts/template.ts";

test("schema validation always skips every root field and sends no credentials", async () => {
  const { validateTemplate } = await import("../scripts/validate-template.ts");
  const queries: string[] = [];
  await validateTemplate(createTemplate({ start: "start", stop: "stop" }), async (_url, init) => {
    const query = JSON.parse(String(init?.body)).query as string;
    expect(query).toContain("@skip(if: true)");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(new Headers(init?.headers).has("Project-Access-Token")).toBe(false);
    queries.push(query);
    return Response.json({ data: {} });
  });
  expect(queries).toHaveLength(4);
});
