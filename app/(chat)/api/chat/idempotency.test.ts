import assert from "node:assert/strict";
import test from "node:test";

import { buildTriggerIdempotencyKey } from "./idempotency";

const BASE_INPUT = {
  chatId: "ed2b6cbf-ea0c-4646-999c-71026d113972",
  userId: "57ffa3c4-00bc-4b6c-830a-c74f25a9ef8e",
  requestId: "ed2b6cbf-ea0c-4646-999c-71026d113972",
  messageId: "eb765fc4-055a-445c-b182-85018d0273d3",
  userText:
    "我初始买入的是159660，我有两个策略：1是一直持有159660 2是按照图片中的切换策略，图片中最后买的是513100",
};

test("idempotency key changes when attachments change under same message id", () => {
  const withoutAttachment = buildTriggerIdempotencyKey({
    ...BASE_INPUT,
    attachments: [],
  });
  const withAttachment = buildTriggerIdempotencyKey({
    ...BASE_INPUT,
    attachments: [
      {
        name: "微信图片_20260305131924_175_251.jpg",
        mediaType: "image/jpeg",
        url: "https://dawqghgjwzxfcgmb.public.blob.vercel-storage.com/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260305131924_175_251-vZnFYQB7qaPozqsNOQJwpbd4yvwrHE.jpg",
      },
    ],
  });

  assert.notEqual(withoutAttachment, withAttachment);
});

test("idempotency key stays stable when attachment set is identical", () => {
  const first = buildTriggerIdempotencyKey({
    ...BASE_INPUT,
    attachments: [
      {
        name: "微信图片_20260305131924_175_251.jpg",
        mediaType: "image/jpeg",
        url: "https://dawqghgjwzxfcgmb.public.blob.vercel-storage.com/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260305131924_175_251-vZnFYQB7qaPozqsNOQJwpbd4yvwrHE.jpg",
      },
    ],
  });
  const second = buildTriggerIdempotencyKey({
    ...BASE_INPUT,
    attachments: [
      {
        name: "微信图片_20260305131924_175_251.jpg",
        mediaType: "image/jpeg",
        url: "https://dawqghgjwzxfcgmb.public.blob.vercel-storage.com/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260305131924_175_251-vZnFYQB7qaPozqsNOQJwpbd4yvwrHE.jpg",
      },
    ],
  });

  assert.equal(first, second);
});
