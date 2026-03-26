import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PIN_CODE = "15215";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";
const GOOGLE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

interface DriveConfig {
  id: string;
  name: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  redirect_uri: string;
  folder_id: string;
  is_active: boolean;
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function getAccessToken(config: DriveConfig): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error_description || err.error || "Failed to get access token");
  }
  const data = await res.json();
  return data.access_token;
}

async function getActiveDrive(supabase: any): Promise<DriveConfig | null> {
  const { data, error } = await supabase
    .from("drive_configs")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .single();
  if (error || !data) {
    // Try first drive
    const { data: first } = await supabase
      .from("drive_configs")
      .select("*")
      .limit(1)
      .single();
    return first || null;
  }
  return data;
}

async function driveRequest(accessToken: string, path: string, options: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${GOOGLE_DRIVE_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  return res;
}

async function getFolderStats(accessToken: string, folderId: string) {
  let totalSize = 0, fileCount = 0, folderCount = 0;
  const foldersToProcess = [folderId];

  while (foldersToProcess.length > 0) {
    const currentId = foldersToProcess.shift()!;
    let pageToken = "";
    do {
      const q = encodeURIComponent(`'${currentId}' in parents and trashed = false`);
      const url = `/files?q=${q}&fields=nextPageToken,files(id,size,mimeType)${pageToken ? `&pageToken=${pageToken}` : ""}`;
      const res = await driveRequest(accessToken, url);
      const data = await res.json();
      for (const file of data.files || []) {
        if (file.mimeType === "application/vnd.google-apps.folder") {
          folderCount++;
          foldersToProcess.push(file.id);
        } else {
          fileCount++;
          totalSize += parseInt(file.size || "0");
        }
      }
      pageToken = data.nextPageToken || "";
    } while (pageToken);
  }
  return { size: totalSize, fileCount, folderCount };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";
    
    let body: any = {};
    if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("multipart/form-data")) {
        body = await req.formData();
      } else if (contentType.includes("application/json")) {
        const text = await req.text();
        if (text && text.trim().length > 0) {
          body = JSON.parse(text);
        }
      }
    }

    // PIN Login
    if (action === "login") {
      const { pin } = body;
      if (pin === PIN_CODE) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: false, error: "Invalid PIN" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List drives
    if (action === "list-drives") {
      const { data } = await supabase.from("drive_configs").select("*").order("created_at");
      return new Response(JSON.stringify(data || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save drive
    if (action === "save-drive") {
      const driveData = body;
      if (!driveData.id) driveData.id = Date.now().toString();

      const { data: existing } = await supabase
        .from("drive_configs")
        .select("id")
        .eq("id", driveData.id)
        .single();

      if (existing) {
        await supabase.from("drive_configs").update({
          name: driveData.name,
          client_id: driveData.clientId,
          client_secret: driveData.clientSecret,
          refresh_token: driveData.refreshToken,
          redirect_uri: driveData.redirectUri,
          folder_id: driveData.folderId,
          is_active: driveData.isActive,
        }).eq("id", driveData.id);
      } else {
        // If first drive, make it active
        const { count } = await supabase.from("drive_configs").select("*", { count: "exact", head: true });
        if (count === 0) driveData.isActive = true;

        await supabase.from("drive_configs").insert({
          id: driveData.id,
          name: driveData.name,
          client_id: driveData.clientId,
          client_secret: driveData.clientSecret,
          refresh_token: driveData.refreshToken,
          redirect_uri: driveData.redirectUri,
          folder_id: driveData.folderId,
          is_active: driveData.isActive || false,
        });
      }

      return new Response(JSON.stringify({ success: true, drive: driveData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete drive
    if (action === "delete-drive") {
      const { id } = body;
      const { data: driveToDelete } = await supabase.from("drive_configs").select("is_active").eq("id", id).single();
      await supabase.from("drive_configs").delete().eq("id", id);

      if (driveToDelete?.is_active) {
        const { data: remaining } = await supabase.from("drive_configs").select("id").limit(1);
        if (remaining && remaining.length > 0) {
          await supabase.from("drive_configs").update({ is_active: true }).eq("id", remaining[0].id);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Select drive
    if (action === "select-drive") {
      const { id } = body;
      await supabase.from("drive_configs").update({ is_active: false }).neq("id", "___");
      await supabase.from("drive_configs").update({ is_active: true }).eq("id", id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Import drives
    if (action === "import-drives") {
      const importedDrives = body;
      if (!Array.isArray(importedDrives)) {
        return new Response(JSON.stringify({ error: "Invalid data format" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const validDrives = importedDrives.filter((d: any) => d.name && d.clientId && d.clientSecret && d.refreshToken);
      if (validDrives.length === 0) {
        return new Response(JSON.stringify({ error: "No valid drives found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const d of validDrives) {
        if (!d.id) d.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        const { data: existing } = await supabase.from("drive_configs").select("id").eq("id", d.id).single();
        if (existing) {
          await supabase.from("drive_configs").update({
            name: d.name, client_id: d.clientId, client_secret: d.clientSecret,
            refresh_token: d.refreshToken, redirect_uri: d.redirectUri || 'https://developers.google.com/oauthplayground',
            folder_id: d.folderId, is_active: d.isActive || false,
          }).eq("id", d.id);
        } else {
          await supabase.from("drive_configs").insert({
            id: d.id, name: d.name, client_id: d.clientId, client_secret: d.clientSecret,
            refresh_token: d.refreshToken, redirect_uri: d.redirectUri || 'https://developers.google.com/oauthplayground',
            folder_id: d.folderId, is_active: d.isActive || false,
          });
        }
      }

      // Ensure at least one active
      const { data: allDrives } = await supabase.from("drive_configs").select("*");
      if (allDrives && allDrives.length > 0 && !allDrives.some((d: any) => d.is_active)) {
        await supabase.from("drive_configs").update({ is_active: true }).eq("id", allDrives[0].id);
      }

      return new Response(JSON.stringify({ success: true, count: validDrives.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Test drive config
    if (action === "test-drive") {
      const config = body;
      try {
        const testConfig: DriveConfig = {
          id: "test", name: "test",
          client_id: config.clientId, client_secret: config.clientSecret,
          refresh_token: config.refreshToken, redirect_uri: config.redirectUri,
          folder_id: config.folderId, is_active: false,
        };
        const accessToken = await getAccessToken(testConfig);
        
        const q = config.folderId 
          ? encodeURIComponent(`'${config.folderId}' in parents and trashed = false`)
          : "";
        const testUrl = q ? `/files?q=${q}&pageSize=1&fields=files(id,name)` : `/files?pageSize=1&fields=files(id,name)`;
        const res = await driveRequest(accessToken, testUrl);
        if (!res.ok) throw new Error("Failed to access drive");

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Config status
    if (action === "config-status") {
      const activeDrive = await getActiveDrive(supabase);
      let hasAuth = false;
      let lastError: string | null = null;

      if (activeDrive) {
        try {
          await getAccessToken(activeDrive);
          hasAuth = true;
        } catch (err: any) {
          lastError = err.message;
        }
      } else {
        lastError = "No drive configured";
      }

      return new Response(JSON.stringify({
        isConfigured: hasAuth && !!activeDrive?.folder_id,
        hasAuth,
        hasFolderId: !!activeDrive?.folder_id,
        activeDrive: activeDrive ? { id: activeDrive.id, name: activeDrive.name } : null,
        diagnostics: {
          hasClientId: !!activeDrive?.client_id,
          hasClientSecret: !!activeDrive?.client_secret,
          hasRefreshToken: !!activeDrive?.refresh_token,
          folderId: activeDrive?.folder_id,
          lastError,
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List files
    if (action === "list-files") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const accessToken = await getAccessToken(activeDrive);
      const folderId = url.searchParams.get("folderId") || activeDrive.folder_id;
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const res = await driveRequest(accessToken, `/files?q=${q}&fields=files(id,name,mimeType,webViewLink,size,modifiedTime,createdTime)`);
      const data = await res.json();
      const files = data.files || [];

      // Get folder stats
      const filesWithStats = await Promise.all(files.map(async (file: any) => {
        if (file.mimeType === "application/vnd.google-apps.folder") {
          try {
            const stats = await getFolderStats(accessToken, file.id);
            return { ...file, size: stats.size.toString(), fileCount: stats.fileCount, folderCount: stats.folderCount };
          } catch {
            return file;
          }
        }
        return file;
      }));

      return new Response(JSON.stringify(filesWithStats), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Storage quota
    if (action === "storage-quota") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const res = await driveRequest(accessToken, "/about?fields=storageQuota");
      const data = await res.json();
      return new Response(JSON.stringify(data.storageQuota), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create folder
    if (action === "create-folder") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { name, parentId } = body;
      const res = await driveRequest(accessToken, "/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "New Folder",
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId || activeDrive.folder_id],
        }),
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rename file
    if (action === "rename-file") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { fileId, name } = body;
      const res = await driveRequest(accessToken, `/files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Move file
    if (action === "move-file") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { fileId, newParentId } = body;
      
      // Get current parents
      const metaRes = await driveRequest(accessToken, `/files/${fileId}?fields=parents`);
      const metaData = await metaRes.json();
      const previousParents = (metaData.parents || []).join(",");

      const res = await driveRequest(accessToken, `/files/${fileId}?addParents=${newParentId}&removeParents=${previousParents}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete file
    if (action === "delete-file") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { fileId } = body;
      await driveRequest(accessToken, `/files/${fileId}`, { method: "DELETE" });
      return new Response(JSON.stringify({ message: "Deleted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Init resumable upload - returns a session URI for direct browser upload
    if (action === "init-upload") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { fileName, mimeType, parentId } = body;

      if (!fileName) {
        return new Response(JSON.stringify({ error: "Missing fileName" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const metadata = {
        name: fileName,
        parents: [parentId || activeDrive.folder_id],
      };

      // Initiate resumable upload session
      const initRes = await fetch(`${GOOGLE_UPLOAD_API}/files?uploadType=resumable&fields=id,name`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType || "application/octet-stream",
        },
        body: JSON.stringify(metadata),
      });

      if (!initRes.ok) {
        const err = await initRes.text();
        throw new Error(`Failed to init upload: ${err}`);
      }

      const sessionUri = initRes.headers.get("Location");
      if (!sessionUri) {
        throw new Error("No upload session URI returned");
      }

      return new Response(JSON.stringify({ success: true, sessionUri }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Proxy upload - streams request body to Google's resumable session URI
    if (action === "proxy-upload") {
      const sessionUri = url.searchParams.get("sessionUri");
      const contentType = req.headers.get("content-type") || "application/octet-stream";
      const contentLength = req.headers.get("content-length");

      if (!sessionUri) {
        return new Response(JSON.stringify({ error: "Missing sessionUri" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const uploadHeaders: Record<string, string> = {
        "Content-Type": contentType,
      };
      if (contentLength) uploadHeaders["Content-Length"] = contentLength;

      // Stream the body directly to Google without buffering
      const uploadRes = await fetch(sessionUri, {
        method: "PUT",
        headers: uploadHeaders,
        body: req.body,
      });

      const uploadData = await uploadRes.text();
      return new Response(uploadData, {
        status: uploadRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload chunk - for chunked uploads to bypass 50MB edge function limit
    if (action === "upload-chunk") {
      const sessionUri = url.searchParams.get("sessionUri");
      const contentRange = url.searchParams.get("contentRange"); // e.g., "bytes 0-5242879/10000000"
      const fileId = url.searchParams.get("fileId");

      if (!sessionUri || !contentRange) {
        return new Response(JSON.stringify({ error: "Missing sessionUri or contentRange" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const chunk = await req.arrayBuffer();

      const uploadRes = await fetch(sessionUri, {
        method: "PUT",
        headers: {
          "Content-Range": contentRange,
          "Content-Length": chunk.byteLength.toString(),
        },
        body: chunk,
      });

      const responseText = await uploadRes.text();

      // Check if upload is complete (201 Created) or still in progress (308 Resume Incomplete)
      const isComplete = uploadRes.status === 201 || uploadRes.status === 200;
      const isInProgress = uploadRes.status === 308;

      let uploadedBytes = 0;
      let totalBytes = 0;

      // Parse Range header from Google response to get upload status
      const rangeHeader = uploadRes.headers.get("Range");
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=0-(\d+)\/(\d+)/);
        if (match) {
          uploadedBytes = parseInt(match[1]) + 1;
          totalBytes = parseInt(match[2]);
        }
      }

      // If we got a file ID in response, extract it
      let returnedFileId = fileId;
      try {
        const parsed = JSON.parse(responseText);
        if (parsed.id) returnedFileId = parsed.id;
      } catch {}

      return new Response(JSON.stringify({
        success: true,
        status: uploadRes.status,
        isComplete,
        uploadedBytes,
        totalBytes,
        fileId: returnedFileId,
        response: responseText
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Query upload status - check how much has been uploaded
    if (action === "query-upload-status") {
      const sessionUri = url.searchParams.get("sessionUri");

      if (!sessionUri) {
        return new Response(JSON.stringify({ error: "Missing sessionUri" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send PUT with Content-Range: * / totalSize to query current position
      const totalSize = url.searchParams.get("totalSize");
      
      const uploadRes = await fetch(sessionUri, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes */${totalSize || "*"}`,
        },
      });

      const rangeHeader = uploadRes.headers.get("Range");
      let uploadedBytes = 0;
      let totalBytes = totalSize ? parseInt(totalSize) : 0;

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=0-(\d+)/);
        if (match) {
          uploadedBytes = parseInt(match[1]) + 1;
        }
      }

      const isComplete = uploadRes.status === 201 || uploadRes.status === 200;

      return new Response(JSON.stringify({
        status: uploadRes.status,
        uploadedBytes,
        totalBytes,
        isComplete,
        rangeHeader
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Set file public after upload completes
    if (action === "finalize-upload") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { fileId } = body;

      if (fileId) {
        await driveRequest(accessToken, `/files/${fileId}/permissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "reader", type: "anyone" }),
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download file
    if (action === "download-file") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const fileId = url.searchParams.get("fileId");
      
      // Get file metadata
      const metaRes = await driveRequest(accessToken, `/files/${fileId}?fields=id,name,mimeType`);
      const fileMeta = await metaRes.json();

      if (fileMeta.mimeType === "application/vnd.google-apps.folder") {
        // For folders, create a simple ZIP
        const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
        const zip = new JSZip();

        const addFolderToZip = async (fId: string, zipFolder: any) => {
          const q = encodeURIComponent(`'${fId}' in parents and trashed = false`);
          const listRes = await driveRequest(accessToken, `/files?q=${q}&fields=files(id,name,mimeType)`);
          const listData = await listRes.json();
          for (const f of listData.files || []) {
            if (f.mimeType === "application/vnd.google-apps.folder") {
              const subFolder = zipFolder.folder(f.name);
              await addFolderToZip(f.id, subFolder);
            } else {
              const fileRes = await driveRequest(accessToken, `/files/${f.id}?alt=media`);
              const fileData = await fileRes.arrayBuffer();
              zipFolder.file(f.name, fileData);
            }
          }
        };

        await addFolderToZip(fileId, zip);
        const zipContent = await zip.generateAsync({ type: "uint8array" });
        
        return new Response(zipContent, {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${fileMeta.name}.zip"`,
          },
        });
      } else {
        // Regular file download
        const fileRes = await driveRequest(accessToken, `/files/${fileId}?alt=media`);
        const fileData = await fileRes.arrayBuffer();
        
        return new Response(fileData, {
          headers: {
            ...corsHeaders,
            "Content-Type": fileMeta.mimeType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${fileMeta.name}"`,
          },
        });
      }
    }

    // Bulk download
    if (action === "download-bulk") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { fileIds, filename } = body;

      const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
      const zip = new JSZip();

      const addFileToZip = async (fId: string, zipFolder: any) => {
        const metaRes = await driveRequest(accessToken, `/files/${fId}?fields=id,name,mimeType`);
        const meta = await metaRes.json();

        if (meta.mimeType === "application/vnd.google-apps.folder") {
          const subFolder = zipFolder.folder(meta.name);
          const q = encodeURIComponent(`'${fId}' in parents and trashed = false`);
          const listRes = await driveRequest(accessToken, `/files?q=${q}&fields=files(id,name,mimeType)`);
          const listData = await listRes.json();
          for (const f of listData.files || []) {
            await addFileToZip(f.id, subFolder);
          }
        } else {
          const fileRes = await driveRequest(accessToken, `/files/${fId}?alt=media`);
          const fileData = await fileRes.arrayBuffer();
          zipFolder.file(meta.name, fileData);
        }
      };

      for (const id of fileIds) {
        await addFileToZip(id, zip);
      }

      const zipContent = await zip.generateAsync({ type: "uint8array" });

      return new Response(zipContent, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename || 'bulk_download.zip'}"`,
        },
      });
    }

    // Bulk move
    if (action === "move-bulk") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { fileIds, targetFolderId } = body;

      for (const fileId of fileIds) {
        const metaRes = await driveRequest(accessToken, `/files/${fileId}?fields=parents`);
        const metaData = await metaRes.json();
        const previousParents = (metaData.parents || []).join(",");
        await driveRequest(accessToken, `/files/${fileId}?addParents=${targetFolderId}&removeParents=${previousParents}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bulk rename
    if (action === "rename-bulk") {
      const activeDrive = await getActiveDrive(supabase);
      if (!activeDrive) {
        return new Response(JSON.stringify({ error: "Drive not initialized" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getAccessToken(activeDrive);
      const { fileIds, baseName } = body;

      for (let i = 0; i < fileIds.length; i++) {
        const metaRes = await driveRequest(accessToken, `/files/${fileIds[i]}?fields=name`);
        const metaData = await metaRes.json();
        const ext = (metaData.name || "").includes(".") ? "." + (metaData.name || "").split(".").pop() : "";
        const newName = `${baseName} ${i + 1}${ext}`;
        await driveRequest(accessToken, `/files/${fileIds[i]}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
