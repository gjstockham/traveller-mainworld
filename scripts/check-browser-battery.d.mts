/**
 * Types for `check-browser-battery.mjs`, so its unit test and an editor can see
 * the analysis surface. Hand-written: the script is plain ESM because `pnpm
 * lint` runs before anything is built and cannot depend on `dist/`.
 */
export interface BrowserGraphViolation {
  /** Repo-relative file the offending import appears in. */
  readonly file: string;
  readonly specifier: string;
  readonly line: number;
  readonly reason: string;
}

export interface BrowserGraphAnalysis {
  /** Every module reached, repo-relative and sorted. */
  readonly visited: string[];
  readonly violations: BrowserGraphViolation[];
}

export interface BrowserGraphInput {
  readonly entries: readonly string[];
  readonly readFile: (file: string) => string | undefined;
  readonly exists: (file: string) => boolean;
}

export declare const HTML_ENTRY: string;
export declare function extractSpecifiers(
  source: string,
): { specifier: string; line: number }[];
export declare function extractHtmlEntries(html: string, htmlPath: string): string[];
export declare function analyseBrowserGraph(input: BrowserGraphInput): BrowserGraphAnalysis;
export declare function checkRepo(repoRoot?: string): BrowserGraphAnalysis;
