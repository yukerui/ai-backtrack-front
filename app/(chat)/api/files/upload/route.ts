import { put } from "@vercel/blob";

import { auth } from "@/app/(auth)/auth";

import { createUploadHandler } from "./upload-handler";

const putBlob: Parameters<typeof createUploadHandler>[0]["putBlob"] = async (
  pathname,
  body,
  options
) => {
  const result = await put(pathname, body, options);

  return {
    url: result.url,
    pathname: result.pathname,
    contentType: result.contentType || options.contentType || "application/octet-stream",
  };
};

export const POST = createUploadHandler({
  authResolver: auth,
  putBlob,
});
