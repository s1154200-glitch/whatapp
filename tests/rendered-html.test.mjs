import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the read-only WhatsApp archive shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>我最愛的媽媽 · Chat Archive<\/title>/i);
  assert.match(html, /WhatsApp chat archive/);
  assert.match(html, /Search chat/);
  assert.match(html, /Jump to a date/);
  assert.match(html, /Read-only chat archive/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("generated archive data and media are complete", async () => {
  const [manifest, searchIndex, monthFiles, mediaFiles] = await Promise.all([
    readJson(new URL("public/data/manifest.json", projectRoot)),
    readJson(new URL("public/data/search.json", projectRoot)),
    readdir(new URL("public/data/months/", projectRoot)),
    readdir(new URL("public/media/", projectRoot)),
  ]);

  assert.equal(manifest.messageCount, 11_231);
  assert.equal(manifest.attachmentCount, 1_234);
  assert.equal(manifest.months.length, 26);
  assert.equal(monthFiles.length, manifest.months.length);
  assert.equal(mediaFiles.length, manifest.attachmentCount);
  assert.ok(searchIndex.length > 8_000);

  const months = await Promise.all(monthFiles.map((file) => readJson(new URL(`public/data/months/${file}`, projectRoot))));
  const messages = months.flat();
  assert.equal(messages.length, manifest.messageCount);
  assert.equal(messages[0].date, manifest.firstDate);
  assert.equal(messages.at(-1).date, manifest.lastDate);

  const attachments = messages.flatMap((message) => message.attachment ? [message.attachment] : []);
  assert.equal(attachments.length, manifest.attachmentCount);
  assert.ok(
    attachments
      .filter((attachment) => attachment.kind === "photo" || attachment.kind === "sticker")
      .every((attachment) => attachment.width > 0 && attachment.height > 0),
  );
  assert.deepEqual(new Set(attachments.map((attachment) => attachment.filename)), new Set(mediaFiles));
});

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
