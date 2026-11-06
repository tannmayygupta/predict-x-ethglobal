import cors from "@fastify/cors";
import type { App } from "../appTypes";

export interface CorsOptions {
  allowedOrigins: string[];
}

/** JSON bodies always need content-type; stating it explicitly keeps preflights deterministic. */
const ALLOWED_HEADERS = ["content-type"];
const ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];

export async function registerCors(app: App, options: CorsOptions): Promise<void> {
  await app.register(cors, {
    origin: options.allowedOrigins,
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
  });
}
