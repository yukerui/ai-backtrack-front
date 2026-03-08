import { NextResponse } from "next/server";
import { z } from "zod";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MISSING_BLOB_TOKEN_ERROR =
  "Upload backend misconfigured: missing BLOB_READ_WRITE_TOKEN";
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const FileSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => file.size <= MAX_FILE_SIZE_BYTES, {
      message: "File size should be less than 10MB",
    })
    .refine((file) => ALLOWED_CONTENT_TYPES.has(file.type), {
      message:
        "Unsupported file type. Allowed: image/pdf/txt/md/csv/json/xls/xlsx",
    }),
});

type BlobPutOptions = {
  access: "public";
  contentType: string;
  token?: string;
};

type BlobPutResult = {
  url: string;
  pathname: string;
  contentType: string;
};

type BlobPutFn = (
  pathname: string,
  data: ArrayBuffer,
  options: BlobPutOptions
) => Promise<BlobPutResult>;

type UploadHandlerDeps = {
  authResolver: () => Promise<unknown>;
  putBlob: BlobPutFn;
  now?: () => number;
  getBlobToken?: () => string;
};

function sanitizeFilename(rawName: string) {
  const normalized = rawName.trim().replace(/[^\w.\-]+/g, "_");
  if (!normalized) {
    return "upload_file";
  }
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

function buildErrorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function mapUploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Upload failed";
  if (/No token found|BLOB_READ_WRITE_TOKEN/i.test(message)) {
    return MISSING_BLOB_TOKEN_ERROR;
  }
  return message;
}

export function resolveBlobTokenFromEnv() {
  const byPriority = [
    process.env.BLOB_READ_WRITE_TOKEN,
    process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
  ];

  for (const candidate of byPriority) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function validateAndGetFile(formData: FormData) {
  const candidate = formData.get("file");
  if (!(candidate instanceof File)) {
    return { error: buildErrorResponse("No file uploaded", 400), file: null };
  }

  const validatedFile = FileSchema.safeParse({ file: candidate });
  if (!validatedFile.success) {
    const errorMessage = validatedFile.error.errors
      .map((error) => error.message)
      .join(", ");
    return { error: buildErrorResponse(errorMessage, 400), file: null };
  }

  return { error: null, file: validatedFile.data.file };
}

export function createUploadHandler({
  authResolver,
  putBlob,
  now = Date.now,
  getBlobToken = resolveBlobTokenFromEnv,
}: UploadHandlerDeps) {
  return async function postUpload(request: Request) {
    const session = await authResolver();
    if (!session) {
      return buildErrorResponse("Unauthorized", 401);
    }

    if (request.body === null) {
      return new Response("Request body is empty", { status: 400 });
    }

    try {
      const formData = await request.formData();
      const validated = validateAndGetFile(formData);
      if (validated.error) {
        return validated.error;
      }

      const token = getBlobToken();
      if (!token) {
        return buildErrorResponse(MISSING_BLOB_TOKEN_ERROR, 500);
      }

      const file = validated.file as File;
      const fileBuffer = await file.arrayBuffer();
      const safeFilename = sanitizeFilename(file.name);
      const objectName = `${now()}-${safeFilename}`;

      const data = await putBlob(objectName, fileBuffer, {
        access: "public",
        contentType: file.type,
        token,
      });

      return NextResponse.json(data);
    } catch (error) {
      return buildErrorResponse(mapUploadErrorMessage(error), 500);
    }
  };
}
