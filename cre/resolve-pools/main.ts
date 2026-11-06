import { CronCapability, handler, Runner } from "@chainlink/cre-sdk"
import { type Config, onCronTrigger } from "./src/workflow"

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
