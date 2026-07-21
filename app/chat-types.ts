export type MediaKind = "photo" | "sticker" | "video" | "audio" | "document" | "other";

export type Attachment = {
  filename: string;
  kind: MediaKind;
  width?: number;
  height?: number;
};

export type ChatMessage = {
  id: number;
  date: string;
  month: string;
  epoch: number;
  time: string;
  sender: string | null;
  text: string;
  attachment: Attachment | null;
};

export type MonthSummary = {
  key: string;
  file: string;
  count: number;
  firstId: number;
  lastId: number;
  firstDate: string;
  lastDate: string;
};

export type DaySummary = {
  date: string;
  month: string;
  firstId: number;
};

export type ChatManifest = {
  version: number;
  title: string;
  selfName: string;
  participants: Array<{ name: string; count: number }>;
  messageCount: number;
  attachmentCount: number;
  attachmentCounts: Record<MediaKind, number>;
  firstDate: string;
  lastDate: string;
  months: MonthSummary[];
  days: DaySummary[];
};

export type SearchEntry = Pick<ChatMessage, "id" | "month" | "date" | "time" | "sender" | "text">;
