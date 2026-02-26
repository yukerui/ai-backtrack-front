import "server-only";
import { createClient, type RedisClientType } from "redis";

let redisClient: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

function getRedisUrl() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("Missing REDIS_URL");
  }
  return redisUrl;
}

function getOrCreateClient() {
  if (redisClient) {
    return redisClient;
  }

  redisClient = createClient({ url: getRedisUrl() });
  redisClient.on("error", (error) => {
    console.error("[redis] Client error:", error);
  });

  return redisClient;
}

export async function getRedisClient() {
  const client = getOrCreateClient();
  if (client.isOpen) {
    return client;
  }

  if (!connectPromise) {
    connectPromise = client
      .connect()
      .then(() => client)
      .finally(() => {
        connectPromise = null;
      });
  }

  return connectPromise;
}
