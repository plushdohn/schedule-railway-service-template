import { START_MUTATION, STOP_MUTATION, TARGET_QUERY, type Send } from "../src/control.ts";
import { CREATE_QUERY, INTERNAL_ENDPOINT, post } from "./create-template.ts";
import type { Template } from "./template.ts";

export async function validateTemplate(config: Template, send: Send = fetch) {
  const uuid = "4fa8a608-38c8-41b3-a498-26d44c8820fc";
  const variables = { serviceId: uuid, environmentId: uuid };
  const skip = " @skip(if: true)";
  const checks = [
    { endpoint: "https://backboard.railway.com/graphql/v2", query: TARGET_QUERY.replace("environmentId: $environmentId) {", `environmentId: $environmentId)${skip} {`), variables },
    { endpoint: "https://backboard.railway.com/graphql/v2", query: START_MUTATION.replace("environmentId: $environmentId)", `environmentId: $environmentId)${skip}`), variables },
    { endpoint: "https://backboard.railway.com/graphql/v2", query: STOP_MUTATION.replace("deploymentStop(id: $id)", `deploymentStop(id: $id)${skip}`), variables: { id: uuid } },
    { endpoint: INTERNAL_ENDPOINT, query: CREATE_QUERY.replace("templateCreateV2(input: $input)", `templateCreateV2(input: $input)${skip}`), variables: { input: { metadata: { name: "Scheduled Railway Service" }, serializedConfig: config } } },
  ];
  for (const check of checks) {
    if (!check.query.includes(skip)) throw new Error("Refusing to validate an operation without its skip directive");
    const result = await post<Record<string, never>>(check.endpoint, check.query, check.variables, undefined, send);
    if (Object.keys(result).length !== 0) throw new Error("Unexpected result: schema validation must not execute root fields");
  }
}

if (import.meta.main) {
  const config = await Bun.file(new URL("../template.json", import.meta.url)).json() as Template;
  await validateTemplate(config);
  console.log("Live Railway GraphQL validation passed for the target query, start, stop, and template creation input. Every root field was skipped; no template or deployment was created.");
  console.log("SerializedTemplateConfig is a JSON scalar: this does not prove authenticated template creation or deployment.");
}
