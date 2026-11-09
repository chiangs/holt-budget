import enGB from "../messages/en-GB.json";

export const locale = "en-GB";
export const messages: Record<string, string> = enGB;
export type MessageId = keyof typeof enGB;
