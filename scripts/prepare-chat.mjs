import { mkdir, readFile, readdir, writeFile, link, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const exportRoot = resolve(projectRoot, "..");
const sourceFile = resolve(exportRoot, "_chat.txt");
const dataRoot = resolve(projectRoot, "public", "data");
const mediaRoot = resolve(projectRoot, "public", "media");
const selfName = process.env.CHAT_SELF?.trim() || "Kai";

const raw = (await readFile(sourceFile, "utf8")).replace(/\r\n/g, "\n");
const headerPattern = /^[\u200e\u200f\ufeff]*\[(\d{1,2})\/(\d{1,2})\/(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})[\u202f\u00a0 ]*([ap])\.?m\.?\]\s+([^:]+):\s?(.*)$/i;

const parsed = [];
let current = null;

for (const line of raw.split("\n")) {
  const match = line.match(headerPattern);
  if (match) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw, secondRaw, meridiemRaw, senderRaw, bodyRaw] = match;
    let hour = Number(hourRaw) % 12;
    if (meridiemRaw.toLowerCase() === "p") hour += 12;
    const day = Number(dayRaw);
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    const epoch = Date.UTC(year, month - 1, day, hour, Number(minuteRaw), Number(secondRaw));

    current = {
      sender: cleanInvisible(senderRaw).trim(),
      rawText: cleanInvisible(bodyRaw),
      year,
      month,
      day,
      hour,
      minute: Number(minuteRaw),
      second: Number(secondRaw),
      epoch,
    };
    parsed.push(current);
  } else if (current) {
    current.rawText += `\n${cleanInvisible(line)}`;
  }
}

if (!parsed.length) throw new Error("No WhatsApp messages were found in _chat.txt");

const availableFiles = new Set(await readdir(exportRoot));
const participantCounts = new Map();
const attachmentCounts = { photo: 0, sticker: 0, video: 0, audio: 0, document: 0, other: 0 };
const missingAttachments = [];
const referencedAttachments = new Set();

const messages = parsed.map((entry, index) => {
  const id = index + 1;
  const date = `${entry.year}-${pad(entry.month)}-${pad(entry.day)}`;
  const monthKey = `${entry.year}-${pad(entry.month)}`;
  const time = formatTime(entry.hour, entry.minute);
  let text = entry.rawText.trimEnd();
  const attachmentMatch = text.match(/<attached:\s*([^>]+)>/i);
  let attachment = null;

  if (attachmentMatch) {
    const filename = basename(attachmentMatch[1].trim());
    if (filename !== attachmentMatch[1].trim() || filename.includes("..")) {
      throw new Error(`Unsafe attachment path at message ${id}`);
    }
    const kind = mediaKind(filename);
    attachment = { filename, kind };
    text = text.replace(attachmentMatch[0], "").trim();
    attachmentCounts[kind] += 1;
    referencedAttachments.add(filename);
    if (!availableFiles.has(filename)) missingAttachments.push(filename);
  }

  const isEncryptionNotice = /messages and calls are end-to-end encrypted/i.test(text);
  const sender = isEncryptionNotice ? null : entry.sender;
  if (sender) participantCounts.set(sender, (participantCounts.get(sender) || 0) + 1);

  return {
    id,
    date,
    month: monthKey,
    epoch: entry.epoch,
    time,
    sender,
    text,
    attachment,
  };
});

for (const message of messages) {
  if (message.attachment?.kind !== "photo" && message.attachment?.kind !== "sticker") continue;
  const dimensions = await readImageDimensions(resolve(exportRoot, message.attachment.filename));
  if (dimensions) Object.assign(message.attachment, dimensions);
}

if (missingAttachments.length) {
  throw new Error(`Missing ${missingAttachments.length} attachments, including ${missingAttachments.slice(0, 3).join(", ")}`);
}

await mkdir(dataRoot, { recursive: true });
await mkdir(mediaRoot, { recursive: true });

const monthGroups = new Map();
for (const message of messages) {
  if (!monthGroups.has(message.month)) monthGroups.set(message.month, []);
  monthGroups.get(message.month).push(message);
}

const months = [];
for (const [key, monthMessages] of monthGroups) {
  const filename = `${key}.json`;
  await writeJson(resolve(dataRoot, "months", filename), monthMessages);
  months.push({
    key,
    file: `data/months/${filename}`,
    count: monthMessages.length,
    firstId: monthMessages[0].id,
    lastId: monthMessages.at(-1).id,
    firstDate: monthMessages[0].date,
    lastDate: monthMessages.at(-1).date,
  });
}

const days = [];
let previousDate = "";
for (const message of messages) {
  if (message.date !== previousDate) {
    days.push({ date: message.date, month: message.month, firstId: message.id });
    previousDate = message.date;
  }
}

const searchIndex = messages
  .filter((message) => message.text)
  .map(({ id, month, date, time, sender, text }) => ({ id, month, date, time, sender, text }));

const participants = [...participantCounts]
  .sort((a, b) => b[1] - a[1])
  .map(([name, count]) => ({ name, count }));
const otherParticipant = participants.find((participant) => participant.name !== selfName)?.name || participants[0]?.name || "WhatsApp Chat";

const manifest = {
  version: 1,
  title: otherParticipant,
  selfName,
  participants,
  messageCount: messages.length,
  attachmentCount: referencedAttachments.size,
  attachmentCounts,
  firstDate: messages[0].date,
  lastDate: messages.at(-1).date,
  months,
  days,
};

await writeJson(resolve(dataRoot, "manifest.json"), manifest);
await writeJson(resolve(dataRoot, "search.json"), searchIndex);

let linked = 0;
for (const filename of referencedAttachments) {
  const source = resolve(exportRoot, filename);
  const destination = resolve(mediaRoot, filename);
  try {
    const [sourceStat, destinationStat] = await Promise.all([stat(source), stat(destination)]);
    if (sourceStat.ino === destinationStat.ino && sourceStat.dev === destinationStat.dev) continue;
  } catch {
    // Create the hard link below when the destination does not exist.
  }

  try {
    await link(source, destination);
    linked += 1;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

console.log(`Prepared ${messages.length.toLocaleString()} messages across ${months.length} months with ${referencedAttachments.size.toLocaleString()} attachments (${linked} newly linked).`);

function cleanInvisible(value) {
  return value.replace(/[\u200e\u200f\ufeff]/g, "");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatTime(hour, minute) {
  const period = hour >= 12 ? "pm" : "am";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${pad(minute)} ${period}`;
}

function mediaKind(filename) {
  const extension = extname(filename).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".heic"].includes(extension)) return "photo";
  if (extension === ".webp") return "sticker";
  if ([".mp4", ".mov", ".m4v"].includes(extension)) return "video";
  if ([".opus", ".ogg", ".m4a", ".mp3", ".wav"].includes(extension)) return "audio";
  if ([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"].includes(extension)) return "document";
  return "other";
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

async function readImageDimensions(path) {
  const buffer = await readFile(path);

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (startOfFrameMarkers.has(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (!length) break;
      offset += length + 2;
    }
  }

  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const format = buffer.toString("ascii", 12, 16);
    if (format === "VP8X" && buffer.length >= 30) {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (format === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (format === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  if (buffer.toString("ascii", 1, 4) === "PNG" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  return null;
}
