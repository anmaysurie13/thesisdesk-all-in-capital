import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(bytes: Buffer): Promise<{ text: string; pages: number | null; status: "ok" | "empty" | "corrupt"; error: string | null }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const clean = String(text).replace(/\s+\n/g, "\n").trim();
    if (clean.length < 40) return { text: clean, pages: totalPages, status: "empty", error: "PDF has no extractable text (scanned image?)" };
    return { text: clean.slice(0, 60_000), pages: totalPages, status: "ok", error: null };
  } catch (err) {
    return { text: "", pages: null, status: "corrupt", error: `Could not read PDF: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}` };
  }
}
