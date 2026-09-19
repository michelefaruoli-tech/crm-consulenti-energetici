import { extractText } from "unpdf";

/** Estrae il livello testo del PDF. Nessun OCR. */
export async function extractCtePdfText(bytes: Uint8Array): Promise<{
  text: string;
  totalPages: number;
}> {
  const result = await extractText(bytes, { mergePages: true });
  const text = result.text;
  return { text, totalPages: result.totalPages };
}
