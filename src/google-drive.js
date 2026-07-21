const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const MANIFEST_NAME = "minimal-reader-library.json";

export function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Google sign-in could not load."));
    document.head.append(script);
  });
}

export function requestDriveToken(clientId) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.appdata",
      callback: (response) => response.error ? reject(new Error(response.error)) : resolve(response.access_token)
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}

async function driveFetch(token, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status}).`);
  return response;
}

export async function listDriveFiles(token) {
  const url = new URL(DRIVE_API);
  url.search = new URLSearchParams({
    spaces: "appDataFolder",
    orderBy: "modifiedTime desc",
    pageSize: "1000",
    fields: "files(id,name,modifiedTime)"
  });
  return (await (await driveFetch(token, url)).json()).files || [];
}

export async function downloadDriveFile(token, id) {
  return (await driveFetch(token, `${DRIVE_API}/${id}?alt=media`)).arrayBuffer();
}

export async function uploadDriveFile(token, { id, name, data, type = "application/octet-stream" }) {
  if (id) {
    await driveFetch(token, `${UPLOAD_API}/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": type }, body: data });
    return id;
  }

  const boundary = `minimal-reader-${crypto.randomUUID()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ["appDataFolder"] })}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
    data,
    `\r\n--${boundary}--`
  ]);
  const response = await driveFetch(token, `${UPLOAD_API}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  return (await response.json()).id;
}

export const googleDriveManifestName = MANIFEST_NAME;
