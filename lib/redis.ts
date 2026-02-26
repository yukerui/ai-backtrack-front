import "server-only";
import { Redis } from "@upstash/redis";

const DEFAULT_UPSTASH_REDIS_REST_URL = "https://eminent-pipefish-38577.upstash.io";
const DEFAULT_UPSTASH_REDIS_REST_TOKEN =
  "AZaxAAIncDEyMjM3ZTNmZDYyY2U0YmViYjY2ZjQ5NzcwMjIzYzQwZXAxMzg1Nzc";

function getRedisUrl() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_URL ||
    DEFAULT_UPSTASH_REDIS_REST_URL;
  if (!url) {
    throw new Error("Missing UPSTASH_REDIS_REST_URL");
  }
  return url;
}

function getRedisToken() {
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || DEFAULT_UPSTASH_REDIS_REST_TOKEN;
  if (!token) {
    throw new Error("Missing UPSTASH_REDIS_REST_TOKEN");
  }
  return token;
}

let redisClient: Redis | null = null;

export function isRedisConfigured() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_URL ||
    DEFAULT_UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || DEFAULT_UPSTASH_REDIS_REST_TOKEN;
  return Boolean(url && token);
}

export function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis({
    url: getRedisUrl(),
    token: getRedisToken(),
  });
  return redisClient;
}
