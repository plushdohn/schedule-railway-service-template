# Scheduled Railway Service

Two **native Railway Functions**, written directly in TypeScript and executed by Bun:

- `functions/start.ts`: starts an existing service, every day at **08:00 UTC**.
- `functions/stop.ts`: stops it, every day at **23:00 UTC**.

No dependencies, package manager, transpilation, bundling, tests or build step.

## Why does the template use `services`?

Railway defines a Function as a **Service running one TypeScript file with Bun**. Functions therefore live under `services` in the serialized template configuration; there is no separate `functions` collection.

`template.json` uses the native representation used by Railway's official CLI:

- The official `ghcr.io/railwayapp/function-bun:1.4.0` runtime image.
- `./run.sh <base64>` containing the **original TypeScript file**, embedded verbatim, not compiled JavaScript.
- Each Function's cron schedule and `restartPolicyType: NEVER`.

The CLI identifies Functions by their `ghcr.io/railwayapp/function...` image. These are not custom application containers or Dockerfile-based services. Each `.ts` file can be pasted directly into a Railway Function's Source Code editor.

## Target configuration

Set these required variables on **start-target**:

- `TARGET_SERVICE_ID`: UUID of the existing service to control.
- `TARGET_ENVIRONMENT_ID`: UUID of that service's environment.
- `RAILWAY_PROJECT_TOKEN`: a Railway **Project Token scoped to the target project's environment**, sent through `Project-Access-Token`.

**stop-target** inherits them via Railway reference variables, e.g. `${{start-target.TARGET_SERVICE_ID}}`.

Do not use the scheduler's own `RAILWAY_SERVICE_ID` or `RAILWAY_ENVIRONMENT_ID` as the target. Keep the schedulers separate from the service they stop. Never commit credentials.

## Create the actual Railway template

Committing `template.json` does **not** register a template on Railway: it is the serialized configuration, not an automatically imported repository manifest. A maintainer must create the platform template once before sharing a real one-click URL.

The documented route is to create the two native Functions in a dedicated Railway project, then generate a template from it:

```sh
railway login
railway link
railway functions new --path functions/start.ts --name start-target --cron '0 8 * * *' --http false --serverless false --watch false
railway functions new --path functions/stop.ts --name stop-target --cron '0 23 * * *' --http false --serverless false --watch false
```

1. Configure each Function's restart policy as **Never**, plus the target variables/references above.
2. Open **Project Settings → Generate Template from Project**.
3. In the composer, make start-target's three variables required with **empty defaults**; retain stop-target's reference defaults. Remove any actual tokens and target IDs before sharing.
4. Create the template and share its actual URL. Marketplace publication is a separate step.

Alternatively, use **Workspace Settings → Templates → New Template** and copy the two entries' image source, inline start command, cron/restart settings and variable definitions from `template.json`.

No registered template URL or authenticated deployment is claimed by this repository.

## Edit and run

Edit the two `.ts` files directly. No `npm install`, `bun install` or compilation is needed. For Functions linked through the CLI:

```sh
railway functions push --path functions/start.ts
railway functions push --path functions/stop.ts
```

After editing a source file, refresh the inline TypeScript in `template.json` using Bun:

```sh
bun -e 'const t = await Bun.file("template.json").json(); for (const s of Object.values(t.services)) { const name = s.name === "start-target" ? "start" : "stop"; s.deploy.startCommand = "./run.sh " + Buffer.from(await Bun.file(`functions/${name}.ts`).text()).toString("base64"); } await Bun.write("template.json", JSON.stringify(t, null, 2) + "\n");'
```

Edit `deploy.cronSchedule` before registering the template, or the **Cron Schedule** setting after deployment. Schedules use five-field expressions in **UTC**, without daylight saving adjustment. Runs must be at least five minutes apart, including hour boundaries: `*/5 * * * *` is valid, while `*/7 * * * *` is not. Railway does not guarantee minute-exact execution.

Running `bun functions/start.ts` or `bun functions/stop.ts` with valid target credentials **performs that action**. With missing variables, each exits nonzero before making a request.

## Behavior and limitations

- Start deploys the target's current configuration, even if an older deployment was removed. A running/already-deploying target is a no-op.
- Stop requests shutdown of every active, non-stopped deployment. An idle target is a no-op; the service, variables and volumes are not deleted.
- Stop fails if a deployment is queued/building/deploying/waiting. Avoid deployment/shutdown overlap and rerun once the in-flight deployment finishes.
- An accepted API request does not prove the target is already healthy or fully stopped. Inspect its deployments to confirm the transition.
- Auto-deploys or other automation can restart the target outside the schedule. There is no distributed lock between the two Functions; do not overlap their schedules.
- API requests have timeouts; failures exit nonzero, without logging raw credential-bearing upstream responses.

## References

- [Railway Functions](https://docs.railway.com/functions), [templates](https://docs.railway.com/templates/create), [cron jobs](https://docs.railway.com/cron-jobs).
- Official CLI: [Function recognition](https://github.com/railwayapp/cli/blob/96b7ee9b0a35afc14cb2fe6d3e17a074b98f319e/src/resources.rs), [creation](https://github.com/railwayapp/cli/blob/96b7ee9b0a35afc14cb2fe6d3e17a074b98f319e/src/commands/functions/new.rs), [inline encoding](https://github.com/railwayapp/cli/blob/96b7ee9b0a35afc14cb2fe6d3e17a074b98f319e/src/commands/functions/common.rs).
- Comparable templates: [Cron Webhook Trigger](https://railway.com/deploy/cron-webhook-trigger) and [Scheduled Jobs](https://railway.com/deploy/scheduled-jobs-or--1).
