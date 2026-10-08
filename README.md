# Scheduled Railway Service

Two **native Railway Functions** schedule the start and stop of an **existing** Railway service. The target is selected through environment variables, not baked into the code.

- **start-target:** weekdays at **08:00 UTC** (`0 8 * * 1-5`).
- **stop-target:** weekdays at **18:00 UTC** (`0 18 * * 1-5`).
- Both Functions run once, exit, and use `restartPolicyType: NEVER`.
- No web server, public domain, Dockerfile, or persistent scheduler is needed.

## What is included

- `functions/start.js` and `functions/stop.js`: standalone, generated single-file Functions. They have no local imports or runtime dependencies.
- `template.json`: Railway's **serialized template configuration**, containing exactly two services, cron settings, inline Function code and required variable definitions.
- `src/`: shared TypeScript implementation and entry points.
- `scripts/`: deterministic bundling, safe live GraphQL schema checks, and an optional platform-template creation helper.
- `tests/` and GitHub Actions: controller, template, creation/read-back, and independent Function process tests.

**A committed JSON file does not register a template on Railway.** A maintainer must create the platform template once using one of the paths below. This repository does not claim an already registered one-click deploy URL; the creation helper prints the actual URL only after reading the created template back successfully.

## Deployers: target configuration

Set these variables on **start-target** when deploying the registered template:

- `TARGET_SERVICE_ID`: the UUID of the service to control.
- `TARGET_ENVIRONMENT_ID`: the UUID of that service's environment.
- `RAILWAY_PROJECT_TOKEN`: a Railway **Project Token scoped to that project's target environment**. The Functions authenticate with the `Project-Access-Token` header; account/workspace tokens are not interchangeable here.

Find service and environment IDs in Railway's service/project settings or dashboard URL. Do **not** use the scheduler Function's own automatically supplied `RAILWAY_SERVICE_ID` or `RAILWAY_ENVIRONMENT_ID` as the target. Self-targeting is rejected.

**stop-target** inherits all three values through Railway reference variables, e.g. `${{start-target.TARGET_SERVICE_ID}}`. Keep the two Functions configured for the same target. The target may be in another project if the supplied Project Token grants access to its environment.

Never commit a token. `.env` files are ignored; `.env.example` contains only empty placeholders. Keep the scheduler in services separate from the target: stopping the target must not stop its scheduler.

### Start/stop semantics

- **Start** queries the target service instance and creates a deployment from its current service configuration with `serviceInstanceDeployV2`. It does not try to restart/redeploy a removed deployment. Already-running targets and deployments already in progress are no-ops.
- **Stop** queries all active deployments and requests `deploymentStop` for each that has not already stopped. An idle target is a no-op. This does not delete the service, variables, or volumes.
- If a target deployment is queued/building/deploying/waiting when the stop Function runs, the Function **fails rather than reporting a successful shutdown**. Avoid deploying across the stop window; inspect the Function logs and rerun once the deployment completes.
- An API success means the request was accepted, **not** that the target is healthy or already fully stopped. Check the target's deployments to confirm the transition.
- Target GitHub auto-deploys, manual deploys, or other automation can start the target outside the schedule. Disable or coordinate them if the service must stay off.
- Each invocation is idempotent with respect to the state it reads, but there is no distributed lock across the two Functions. Do not overlap their schedules.

The target must already have a configured deployable source. Starting may build/deploy its current configuration; it is not a guarantee to restore an older release. Functions do not migrate data, and stopping does not remove storage charges.

## Maintainers: build the template

Node/npm are only needed for repository tooling; Railway runs the resulting Functions with Bun.

```sh
npm ci
npm run build
npm run typecheck
npm test
```

`build` regenerates both standalone Function files and `template.json`. Commit the three generated artifacts together with source changes. The runtime is pinned to the official `ghcr.io/railwayapp/function-bun:1.4.0` image, matching Railway's runtime-discovery query when this template was implemented. Updating the image is an explicit, reviewed change.

### Customize the schedules

```sh
START_CRON_SCHEDULE='0 7 * * 1-5' \
STOP_CRON_SCHEDULE='0 19 * * 1-5' \
npm run build
```

Schedules use **UTC**, not your local timezone, and do not automatically follow daylight saving changes. The generator accepts numeric five-field expressions (numbers, `*`, lists, ranges and steps) and rejects schedules with runs less than five minutes apart, including hour/day boundaries. For example, `*/5 * * * *` is valid but `*/7 * * * *` is not: its hour-boundary gap is only four minutes. Named months/weekdays and extended syntax such as `L` or `?` are deliberately not supported by the generator. You can also edit each Function's Cron Schedule in Railway after deployment. A `START_CRON_SCHEDULE` variable on a running Function does not alter Railway's scheduler: these two variables are **build-time inputs** only.

### Path A: documented Railway template composer

1. Open **Workspace Settings → Templates → New Template**.
2. Add two services named exactly **start-target** and **stop-target**.
3. For each service, use its `source.image` value from `template.json` as the Docker image source. This is Railway's own Function runtime, not a custom application container.
4. Copy the corresponding `deploy.startCommand` into **Start Command**, `deploy.cronSchedule` into **Cron Schedule**, and set **Restart Policy → Never**. Do not create a public domain or healthcheck.
5. Add the required variable definitions from `variables`: blank defaults on start-target, reference-variable defaults on stop-target. Descriptions explain what deployers must supply. **Do not store your own target IDs or token as template defaults.**
6. Create the template, then review/share the real deploy URL. Marketplace publication is a separate Railway step.

This representation is the same one used by Railway's CLI for native Functions: the official Function image plus `./run.sh <standard-base64-single-file-source>`. The bundled source can also be copied into a Function's Source Code editor.

Alternatively, create the two Functions in a dedicated Railway project, configure their cron/restart/variable settings, and use **Project Settings → Generate Template from Project**. Before sharing, remove real credentials and target IDs from the generated template defaults.

### Path B: optional creation helper (internal API)

The helper uses the **first-party template composer's internal** `templateCreateV2` operation. This is not a documented public API contract. API-token access is not guaranteed; if Railway rejects it or changes the operation, use Path A rather than substituting a fabricated deploy URL.

Inspect the payload without making any request:

```sh
npm run template:create
```

To actually create a platform template, supply an **account/workspace API token** with template-creation access (not the target Project Token):

```sh
export RAILWAY_API_TOKEN='your-account-or-workspace-api-token'
export RAILWAY_WORKSPACE_ID='your-workspace-uuid'
npm run template:create -- --create
```

This creates a template, **not a live project or deployment**. It reads the exact new template ID back and verifies both Functions, inline code, schedules, restart policies and variable defaults before printing the deploy URL and writing the ignored `railway-template-result.json`. If read-back fails after creation, inspect the created template before retrying to avoid duplicates. Creation does not publish the template to the marketplace.

### Safe online schema validation

```sh
npm run template:validate
```

This sends the real query/mutation documents and template input to Railway, with **every root field skipped** using `@skip(if: true)`. It sends no credentials and executes no creation, start or stop action.

It verifies GraphQL documents and input coercion, **not authenticated execution**. `SerializedTemplateConfig` is a JSON scalar, so this check cannot prove that Railway will deploy the embedded configuration. The local tests independently check its shape, source embedding, variables and settings. A real authenticated test deployment remains necessary before advertising a published template as production-verified.

## Verification

```sh
npm run check
```

CI runs type checks, tests, a deterministic rebuild and a generated-artifact drift check. Integration tests run both standalone Functions as real independent Bun processes against a **local HTTP API fixture**; they do not control an actual Railway service. Network/schema checks are opt-in, not a flaky CI dependency.

To inspect a Function manually without side effects, run it without target credentials: it must exit nonzero with a missing-variable error. Running it with valid target credentials **does perform the requested start/stop action**.

## Sources and comparable Railway templates

- [Railway Functions](https://docs.railway.com/functions)
- [Creating Railway templates](https://docs.railway.com/templates/create)
- [Cron jobs](https://docs.railway.com/cron-jobs)
- [Managing deployments with the public API](https://docs.railway.com/integrations/api/manage-deployments)
- [CLI Function creation](https://github.com/railwayapp/cli/blob/96b7ee9b0a35afc14cb2fe6d3e17a074b98f319e/src/commands/functions/new.rs) and [single-file encoding](https://github.com/railwayapp/cli/blob/96b7ee9b0a35afc14cb2fe6d3e17a074b98f319e/src/commands/functions/common.rs)
- Existing templates used to check the serialized configuration format: [Cron Webhook Trigger](https://railway.com/deploy/cron-webhook-trigger) (native Function image/inline command) and [Scheduled Jobs](https://railway.com/deploy/scheduled-jobs-or--1) (cron configuration).
