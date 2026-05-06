/**
 * @deprecated M1-A1：behavior-routes.ts 已 stub 化。
 * 所有 /api/behaviors/* 路徑暫時回 503（v2 重構中）。
 * M1-C 接管後重寫完整 CRUD API（基於 v2 schema）。
 */

import type { FastifyInstance } from "fastify";
import type { BehaviorRoutesOptions } from "./behavior-helpers.js";

export type { BehaviorRoutesOptions };

const STUB_BODY = {
  error: "Behavior API v2 重構中（M1-A1），暫時不可用。請等待 M1-C 完成。",
  status: "rebuilding",
};

export async function registerBehaviorRoutes(
  server: FastifyInstance,
  _options: BehaviorRoutesOptions = {},
): Promise<void> {
  // M1-A1: stub — 所有 /api/behaviors/* 回 503
  // M1-C 接管後移除此 stub，改為完整 v2 CRUD 實作。

  const stub503 = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    reply.code(503).send(STUB_BODY);
  };

  // Behaviors CRUD
  server.get("/api/behaviors/targets/:id/behaviors", stub503);
  server.post("/api/behaviors/targets/:id/behaviors", stub503);
  server.patch("/api/behaviors/behaviors/:behaviorId", stub503);
  server.delete("/api/behaviors/behaviors/:behaviorId", stub503);
  server.patch("/api/behaviors/targets/:id/behaviors/reorder", stub503);

  // Targets CRUD
  server.get("/api/behaviors/targets", stub503);
  server.post("/api/behaviors/targets", stub503);
  server.get("/api/behaviors/targets/:id", stub503);
  server.patch("/api/behaviors/targets/:id", stub503);
  server.delete("/api/behaviors/targets/:id", stub503);

  // Group members
  server.get("/api/behaviors/targets/:id/members", stub503);
  server.post("/api/behaviors/targets/:id/members", stub503);
  server.delete("/api/behaviors/targets/:id/members/:userId", stub503);
  server.put("/api/behaviors/targets/:id/members", stub503);
}
