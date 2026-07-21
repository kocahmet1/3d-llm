/**
 * Demo-director corpus endpoint. The finale of the scripted competition
 * flight fills the Custom Training textarea with real text from a local
 * folder instead of a canned passage. Browsers cannot read disk paths, but
 * the dev server can — so the director fetches the folder's contents here.
 *
 * Reads every .txt/.md file in DIRECTOR_CORPUS_DIR (defaults to the demo
 * folder on this machine), concatenated in filename order. Returns 404 when
 * the folder is missing, unreadable, or empty — including on serverless
 * deployments with no filesystem — and the director then falls back to its
 * built-in passage.
 */

const CORPUS_DIR_FALLBACK = "C:\\Users\\Test1\\Desktop\\aaa";
const TEXT_FILE_PATTERN = /\.(txt|md|markdown|text)$/i;
/** Keep the on-camera textarea responsive; the trainer allows far more. */
const MAX_RESPONSE_BYTES = 1_500_000;

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const [{ promises: fs }, path] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    const directory = process.env.DIRECTOR_CORPUS_DIR ?? CORPUS_DIR_FALLBACK;
    const names = (await fs.readdir(directory))
      .filter((name) => TEXT_FILE_PATTERN.test(name))
      .sort((a, b) => a.localeCompare(b));

    const parts: string[] = [];
    let total = 0;
    for (const name of names) {
      const text = await fs.readFile(path.join(directory, name), "utf8");
      parts.push(text.trim());
      total += text.length;
      if (total >= MAX_RESPONSE_BYTES) break;
    }

    const corpus = parts.join("\n\n").slice(0, MAX_RESPONSE_BYTES);
    if (!corpus.trim()) {
      return new Response("no text files found", { status: 404 });
    }
    return new Response(corpus, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("corpus folder unavailable", { status: 404 });
  }
}
