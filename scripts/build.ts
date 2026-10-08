// Refresh inline Function source without compiling code or changing template settings.
type Service = {
  name: string;
  deploy: { startCommand: string; [key: string]: unknown };
  [key: string]: unknown;
};

const templatePath = new URL("../template.json", import.meta.url);
const template: { services: Record<string, Service>; [key: string]: unknown } =
  await Bun.file(templatePath).json();
const services = Object.values(template.services);
const functions = [
  { name: "start-target", file: new URL("../functions/start.ts", import.meta.url) },
  { name: "stop-target", file: new URL("../functions/stop.ts", import.meta.url) },
];

if (services.length !== functions.length) {
  throw new Error("The template must contain exactly two Function services");
}

for (const { name, file } of functions) {
  const matches = services.filter((service) => service.name === name);
  if (matches.length !== 1 || !matches[0].deploy) {
    throw new Error(`Expected exactly one ${name} service with deploy settings`);
  }

  const source = await Bun.file(file).arrayBuffer();
  if (source.byteLength === 0) throw new Error(`${name} source is empty`);
  const command = `./run.sh ${Buffer.from(source).toString("base64")}`;
  // Match Railway CLI's limit on the complete encoded start command.
  if (Buffer.byteLength(command) >= 96 * 1024) {
    throw new Error(`${name} encoded command must be smaller than 96 KiB`);
  }
  matches[0].deploy.startCommand = command;
}

// Write only after both Functions have been read and validated successfully.
await Bun.write(templatePath, JSON.stringify(template, null, 2) + "\n");
console.log("Updated template.json with start-target and stop-target TypeScript source");

export {};
