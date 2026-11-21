import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { swallow } from '../common/swallow';

/**
 * Converts Office documents (ppt/pptx/doc/docx/xls/xlsx and friends) to PDF so
 * they can be previewed IN-APP without shipping the file to a third party. It
 * shells out to a headless LibreOffice (`soffice`) — the one dependency this
 * feature needs on the server.
 *
 * It fails SOFT: if LibreOffice isn't installed, `convertToPdf` returns null and
 * the caller marks the material "preview unavailable, download to view" rather
 * than blocking the upload. Point at a specific binary with LIBREOFFICE_PATH.
 */

/** Extensions we route through LibreOffice → PDF for in-app preview. */
export const CONVERTIBLE_EXTENSIONS = new Set([
  'ppt',
  'pptx',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'txt',
  'odt',
  'odp',
  'ods',
]);

/** Extensions the browser can render natively — previewed from the original, no conversion. */
export const NATIVE_PREVIEW_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'mp4',
  'webm',
  'mov',
  'mp3',
]);

@Injectable()
export class DocumentConversionService {
  private readonly logger = new Logger(DocumentConversionService.name);

  /**
   * Master switch. DORMANT BY DEFAULT — Office→PDF conversion is fully built but
   * turned OFF so it never spawns LibreOffice or burdens the server. Today the
   * product policy is "upload slides as PDF" (PDFs/images/AV preview natively).
   * To revive it later: install LibreOffice and set LEARNING_DOC_CONVERSION=on.
   * See LEARNING_DOC_PREVIEW.md.
   */
  get enabled(): boolean {
    return (process.env.LEARNING_DOC_CONVERSION ?? '').trim().toLowerCase() === 'on';
  }

  /** Candidate binaries: explicit env override first, then the usual names on PATH. */
  private get candidates(): string[] {
    const explicit = process.env.LIBREOFFICE_PATH;
    return [
      ...(explicit ? [explicit] : []),
      'soffice',
      'libreoffice',
      // Common Windows install location (dev machines).
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    ];
  }

  /** True when at least one candidate binary looks runnable. */
  get isAvailable(): boolean {
    return this.candidates.some(
      (c) => c === 'soffice' || c === 'libreoffice' || existsSync(c),
    );
  }

  /**
   * Convert a document buffer to a PDF buffer, or null if conversion isn't
   * possible (binary missing / unsupported / failure). Never throws.
   */
  async convertToPdf(input: Buffer, originalName: string): Promise<Buffer | null> {
    const workDir = await mkdtemp(join(tmpdir(), 'lo-convert-'));
    const srcName = `${randomUUID()}-${sanitize(originalName)}`;
    const srcPath = join(workDir, srcName);
    try {
      await writeFile(srcPath, input);
      for (const bin of this.candidates) {
        if (bin.includes('\\') && !existsSync(bin)) continue; // skip missing absolute path
        const ok = await this.runSoffice(bin, srcPath, workDir);
        if (!ok) continue;
        const pdf = await this.readProducedPdf(workDir, srcName);
        if (pdf) return pdf;
      }
      this.logger.warn(
        `PDF preview unavailable for "${originalName}" — LibreOffice not found or conversion failed.`,
      );
      return null;
    } catch (err) {
      this.logger.warn(`Doc→PDF conversion errored for "${originalName}": ${(err as Error).message}`);
      return null;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(swallow('document-conversion.convertToPdf'));
    }
  }

  /** Run `soffice --headless --convert-to pdf`. Resolves true on a clean exit. */
  private runSoffice(bin: string, srcPath: string, outDir: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: boolean) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      let child;
      try {
        child = spawn(
          bin,
          [
            '--headless',
            '--norestore',
            '--nolockcheck',
            '--convert-to',
            'pdf',
            '--outdir',
            outDir,
            srcPath,
          ],
          { windowsHide: true },
        );
      } catch {
        return done(false); // ENOENT etc. — try next candidate
      }
      // A stuck LibreOffice must not hang the request forever.
      const timer = setTimeout(() => {
        child?.kill('SIGKILL');
        done(false);
      }, 60_000);
      child.on('error', () => {
        clearTimeout(timer);
        done(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        done(code === 0);
      });
    });
  }

  /** The produced PDF shares the source basename with a .pdf extension. */
  private async readProducedPdf(dir: string, srcName: string): Promise<Buffer | null> {
    const base = srcName.replace(/\.[^.]+$/, '');
    const expected = `${base}.pdf`;
    const files = await readdir(dir).catch(() => [] as string[]);
    const match = files.includes(expected)
      ? expected
      : files.find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!match) return null;
    return readFile(join(dir, match)).catch(swallow('document-conversion.readProducedPdf', null));
  }
}

/** Strip path separators / control chars so the temp filename is safe. */
function sanitize(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
}
