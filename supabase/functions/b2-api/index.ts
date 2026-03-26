import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function getS3Config() {
  const endpoint = Deno.env.get("YEETFILE_S3_ENDPOINT");
  const region = Deno.env.get("YEETFILE_S3_REGION");
  const bucket = Deno.env.get("YEETFILE_S3_BUCKET_NAME");
  const accessKeyId = Deno.env.get("YEETFILE_S3_ACCESS_KEY_ID");
  const secretKey = Deno.env.get("YEETFILE_S3_SECRET_KEY");

  if (!endpoint || !region || !bucket || !accessKeyId || !secretKey) {
    throw new Error("Missing B2 S3 configuration. Please set all YEETFILE_S3_* secrets.");
  }

  return { endpoint, region, bucket, accessKeyId, secretKey };
}

// AWS Signature V4 helpers
function hmacSha256(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    .then(k => crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)));
}

async function sha256(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string) {
  let kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  let kRegion = await hmacSha256(new Uint8Array(kDate), region);
  let kService = await hmacSha256(new Uint8Array(kRegion), service);
  let kSigning = await hmacSha256(new Uint8Array(kService), "aws4_request");
  return new Uint8Array(kSigning);
}

async function signRequest(
  method: string,
  path: string,
  query: string,
  headers: Record<string, string>,
  body: Uint8Array | string,
  config: ReturnType<typeof getS3Config>,
  unsignedPayload = false
) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  headers["x-amz-date"] = amzDate;
  headers["host"] = config.endpoint;

  const payloadHash = unsignedPayload ? "UNSIGNED-PAYLOAD" : await sha256(typeof body === "string" ? body : body);
  headers["x-amz-content-sha256"] = payloadHash;

  const signedHeaderKeys = Object.keys(headers).sort().map(k => k.toLowerCase());
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join("");

  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`;

  const signingKey = await getSignatureKey(config.secretKey, dateStamp, config.region, "s3");
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = [...new Uint8Array(signatureBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}

async function s3Request(
  method: string,
  path: string,
  config: ReturnType<typeof getS3Config>,
  body: Uint8Array | string = "",
  query = "",
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extraHeaders };
  await signRequest(method, path, query, headers, body, config, true);

  const url = `https://${config.endpoint}${path}${query ? "?" + query : ""}`;
  const res = await fetch(url, { method, headers, body: method !== "GET" && method !== "HEAD" && method !== "DELETE" && body ? body : undefined });
  return res;
}

// XML parsing helpers
function extractXmlValues(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "gs");
  const matches = [];
  let m;
  while ((m = regex.exec(xml)) !== null) matches.push(m[1]);
  return matches;
}

function extractXmlBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g");
  const matches = [];
  let m;
  while ((m = regex.exec(xml)) !== null) matches.push(m[0]);
  return matches;
}

function extractXmlValue(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
  return m ? m[1] : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      return new Response(JSON.stringify({ error: "Missing action parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = getS3Config();
    const bucketPath = `/${config.bucket}`;

    switch (action) {
      case "list": {
        const prefix = url.searchParams.get("prefix") || "";
        const queryParts = ["list-type=2"];
        if (prefix) queryParts.push(`prefix=${encodeURIComponent(prefix)}`);
        queryParts.push("max-keys=1000");

        const res = await s3Request("GET", bucketPath, config, "", queryParts.join("&"));
        const xml = await res.text();

        if (!res.ok) {
          return new Response(JSON.stringify({ error: "Failed to list files", details: xml }), {
            status: res.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const contents = extractXmlBlocks(xml, "Contents");
        const files = contents.map(block => ({
          key: extractXmlValue(block, "Key"),
          size: parseInt(extractXmlValue(block, "Size") || "0"),
          lastModified: extractXmlValue(block, "LastModified"),
          etag: extractXmlValue(block, "ETag").replace(/"/g, ""),
        }));

        return new Response(JSON.stringify({ success: true, files }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "presign-upload": {
        const text = await req.text();
        const body = text ? JSON.parse(text) : {};
        const key = body.key || url.searchParams.get("key");
        const contentType = body.contentType || "application/octet-stream";

        if (!key) {
          return new Response(JSON.stringify({ error: "Missing key" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const uploadPath = `${bucketPath}/${encodeURIComponent(key)}`;
        const headers: Record<string, string> = {
          "content-type": contentType,
        };
        await signRequest("PUT", uploadPath, "", headers, "", config, true);

        const presignedUrl = `https://${config.endpoint}${uploadPath}`;

        return new Response(JSON.stringify({
          success: true,
          url: presignedUrl,
          headers,
          key,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "delete": {
        const text = await req.text();
        const body = text ? JSON.parse(text) : {};
        const key = body.key || url.searchParams.get("key");

        if (!key) {
          return new Response(JSON.stringify({ error: "Missing key" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const deletePath = `${bucketPath}/${encodeURIComponent(key)}`;
        const res = await s3Request("DELETE", deletePath, config);

        if (!res.ok && res.status !== 204) {
          const errText = await res.text();
          return new Response(JSON.stringify({ error: "Delete failed", details: errText }), {
            status: res.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "download": {
        const key = url.searchParams.get("key");
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing key" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const downloadPath = `${bucketPath}/${encodeURIComponent(key)}`;
        const res = await s3Request("GET", downloadPath, config);

        if (!res.ok) {
          const errText = await res.text();
          return new Response(JSON.stringify({ error: "Download failed", details: errText }), {
            status: res.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const fileName = key.split("/").pop() || key;
        const contentType = res.headers.get("content-type") || "application/octet-stream";
        
        // Convert response to ArrayBuffer for proper streaming
        const arrayBuffer = await res.arrayBuffer();
        
        return new Response(arrayBuffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Content-Length": arrayBuffer.byteLength.toString(),
          },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
