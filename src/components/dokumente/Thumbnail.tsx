/**
 * Lazy-Loading-Thumbnail für Dateien aus Supabase Storage.
 *
 *  - Bilder       → direkt als <img> mit Signed-URL
 *  - PDFs         → pdfjs rendert die erste Seite in ein 512×512-Canvas
 *  - XLSX/XLS     → xlsx liest erste Tabelle, zeichnet sie als HTML-Tabelle
 *                   in ein versteckes Div und screenshot't mit html2canvas
 *  - DOCX/PPT/…   → schön formatierter „Aktenkarten"-Style mit Extension
 *  - Andere       → Generic File-Icon
 *
 * Thumbnails werden per Datei-`storage_path` im Modul-Cache gehalten,
 * damit gleiche Dateien nicht zweimal gerendert werden.
 */

import { useEffect, useRef, useState } from "react";
import { FileText, File as FileIcon, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

type FileKind = "image" | "pdf" | "xlsx" | "docx" | "pptx" | "video" | "other";

interface ThumbnailProps {
  bucket: string;
  storagePath: string;
  dateiname: string;
  mimetype?: string | null;
  className?: string;
}

function detectKind(name: string, mt?: string | null): FileKind {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const m = (mt ?? "").toLowerCase();
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext))
    return "image";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (["xlsx", "xls", "ods", "csv"].includes(ext)) return "xlsx";
  if (["docx", "doc", "odt", "rtf"].includes(ext)) return "docx";
  if (["pptx", "ppt", "odp"].includes(ext)) return "pptx";
  if (m.startsWith("video/") || ["mp4", "webm", "mov"].includes(ext)) return "video";
  return "other";
}

const cache = new Map<string, string>();

async function renderPdfThumbnail(url: string): Promise<string> {
  // pdfjs einmal importiert lazy laden, damit es nicht im initial bundle
  // landet, wenn der User nie auf Dokumente klickt.
  const pdfjsLib = await import("pdfjs-dist");
  // @ts-expect-error — Vite ?url-Import gibt String
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  (pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerUrl;

  const buf = await (await fetch(url)).arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const targetSize = 512;
  const scale = Math.min(
    targetSize / viewport.width,
    targetSize / viewport.height,
  );
  const scaled = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: scaled } as any).promise;
  return canvas.toDataURL("image/jpeg", 0.7);
}

async function renderXlsxThumbnail(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  // Rohdaten in 2D-Array für Anzeige
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const slice = rows.slice(0, 18).map((r) => r.slice(0, 8));

  // Canvas direkt zeichnen — kein html2canvas-Overhead.
  const W = 480;
  const H = 480;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header-Stripe
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(0, 0, W, 28);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px -apple-system, system-ui, sans-serif";
  ctx.fillText(sheetName, 10, 19);

  const cols = Math.max(1, slice[0]?.length ?? 1);
  const cellW = (W - 8) / cols;
  const cellH = 24;
  ctx.font = "11px -apple-system, system-ui, sans-serif";

  slice.forEach((row, ri) => {
    const y = 32 + ri * cellH;
    for (let ci = 0; ci < cols; ci++) {
      const x = 4 + ci * cellW;
      // Zell-Hintergrund (erste Zeile als Header dunkler)
      ctx.fillStyle = ri === 0 ? "#f3f4f6" : "#ffffff";
      ctx.fillRect(x, y, cellW, cellH);
      ctx.strokeStyle = "#e5e7eb";
      ctx.strokeRect(x, y, cellW, cellH);
      const v = row[ci];
      if (v == null || v === "") continue;
      ctx.fillStyle = ri === 0 ? "#111827" : "#374151";
      const str = String(v).slice(0, 14);
      ctx.fillText(str, x + 4, y + 16);
    }
  });
  return canvas.toDataURL("image/jpeg", 0.75);
}

async function renderVideoThumbnail(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadeddata", () => {
      try {
        const canvas = document.createElement("canvas");
        const ratio = video.videoWidth / video.videoHeight || 1;
        const w = 480;
        const h = w / ratio;
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } catch (e) {
        reject(e);
      }
    });
    video.addEventListener("error", () => reject(new Error("Video-Load fehlgeschlagen")));
    video.currentTime = 0.5;
  });
}

export function Thumbnail({
  bucket,
  storagePath,
  dateiname,
  mimetype,
  className,
}: ThumbnailProps) {
  const kind = detectKind(dateiname, mimetype);
  const cacheKey = `${bucket}:${storagePath}`;
  const [src, setSrc] = useState<string | null>(() => cache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(!cache.has(cacheKey));
  const [failed, setFailed] = useState(false);
  const aborted = useRef(false);

  useEffect(() => {
    if (cache.has(cacheKey)) {
      setSrc(cache.get(cacheKey)!);
      return;
    }
    if (kind === "docx" || kind === "pptx" || kind === "other") {
      setLoading(false);
      return;
    }
    aborted.current = false;
    setLoading(true);
    setFailed(false);

    (async () => {
      try {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(storagePath, 600);
        if (error || !data) throw error ?? new Error("kein Signed-URL");
        if (aborted.current) return;

        if (kind === "image") {
          cache.set(cacheKey, data.signedUrl);
          setSrc(data.signedUrl);
        } else if (kind === "pdf") {
          const dataUrl = await renderPdfThumbnail(data.signedUrl);
          if (aborted.current) return;
          cache.set(cacheKey, dataUrl);
          setSrc(dataUrl);
        } else if (kind === "xlsx") {
          const dataUrl = await renderXlsxThumbnail(data.signedUrl);
          if (aborted.current) return;
          cache.set(cacheKey, dataUrl);
          setSrc(dataUrl);
        } else if (kind === "video") {
          const dataUrl = await renderVideoThumbnail(data.signedUrl);
          if (aborted.current) return;
          cache.set(cacheKey, dataUrl);
          setSrc(dataUrl);
        }
      } catch {
        if (!aborted.current) setFailed(true);
      } finally {
        if (!aborted.current) setLoading(false);
      }
    })();
    return () => {
      aborted.current = true;
    };
  }, [bucket, storagePath, kind, cacheKey]);

  const baseClass =
    className ??
    "absolute inset-0 h-full w-full object-cover bg-white";

  if (src) {
    return (
      <img
        src={src}
        alt={dateiname}
        loading="lazy"
        className={baseClass}
      />
    );
  }

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-muted">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Fallback (DOCX/PPTX/Other oder Render-Fehler) — Aktenkarte mit Extension
  const ext = (dateiname.split(".").pop() ?? "").toUpperCase().slice(0, 5);
  const palette: Record<string, { bg: string; fg: string }> = {
    DOCX: { bg: "#dbeafe", fg: "#1e40af" },
    DOC: { bg: "#dbeafe", fg: "#1e40af" },
    PPTX: { bg: "#fed7aa", fg: "#9a3412" },
    PPT: { bg: "#fed7aa", fg: "#9a3412" },
    ZIP: { bg: "#e9d5ff", fg: "#6b21a8" },
    TXT: { bg: "#f3f4f6", fg: "#374151" },
  };
  const col = palette[ext] ?? { bg: "#f3f4f6", fg: "#374151" };
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2"
      style={{ backgroundColor: col.bg }}
    >
      {failed && kind === "pdf" ? (
        <FileText className="h-12 w-12" style={{ color: col.fg }} />
      ) : (
        <FileIcon className="h-12 w-12" style={{ color: col.fg }} />
      )}
      <div
        className="text-xs font-bold tracking-wider"
        style={{ color: col.fg }}
      >
        {ext || "FILE"}
      </div>
    </div>
  );
}
