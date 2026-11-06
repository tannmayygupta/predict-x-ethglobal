import {
  FlashOrderDetail,
  FlashOrderRequest,
  FlashOrderResponse,
  FlashQuoteRequest,
  FlashQuoteResponse,
} from "@predictx/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { OrdersRepo } from "../db/orders";
import { QuotesRepo } from "../db/quotes";
import { routeConfig } from "../plugins/validation";
import { FlashService } from "../services/flash";

/** Not in the shared schemas: the contract fixes only the path; ids are opaque strings (mock or Flash UUID). */
export const OrderParams = z.object({ orderId: z.string().min(1) });

const flashRoutes: FastifyPluginAsync = async (app) => {
  const { db, clock, flash, config } = app.deps;
  // Mock orders move no funds, so only the real Flash client needs the opt-in.
  const ordersEnabled = config.flashMock || config.flashOrdersEnabled;
  const service = new FlashService(
    { flash, clock, quotes: new QuotesRepo(db), orders: new OrdersRepo(db), ordersEnabled },
    app.log,
  );

  app.post(
    "/flash/quote",
    { config: routeConfig({ body: FlashQuoteRequest, response: FlashQuoteResponse }) },
    async (request) => service.quote(FlashQuoteRequest.parse(request.parsed.body)),
  );

  app.post(
    "/flash/order",
    { config: routeConfig({ body: FlashOrderRequest, response: FlashOrderResponse }) },
    async (request) => service.order(FlashOrderRequest.parse(request.parsed.body)),
  );

  app.get(
    "/flash/order/:orderId",
    { config: routeConfig({ params: OrderParams, response: FlashOrderDetail }) },
    async (request) => service.status(OrderParams.parse(request.parsed.params).orderId),
  );
};

export default flashRoutes;
