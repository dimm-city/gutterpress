export interface PrintMdManifest {
  title?: string;
  authors?: string[];
  preset?: "dtrpg";
  styles?: string[];
  source?: {
    chapters?: string;
    assets?: string[];
  };
  output?: {
    dir?: string;
    filename?: string;
    html?: string;
  };
  pdfx?: {
    flavor?: "x1a" | "x3";
    icc?: string;
    stripAnnotations?: boolean;
  };
  page?: {
    width?: number;
    height?: number;
    tolerance?: number;
  };
  ink?: {
    maxTac?: number;
    tacTolerance?: number;
  };
  lint?: {
    enabled?: boolean;
    configPath?: string | null;
  };
}

/** Fully-resolved config with no optional fields. */
export interface ResolvedConfig {
  title: string;
  authors: string[];
  styles: string[];
  source: {
    chapters: string;
    assets: string[];
  };
  output: {
    dir: string;
    filename: string;
    html: string;
  };
  pdfx: {
    flavor: "x1a" | "x3";
    icc: string;
    stripAnnotations: boolean;
  };
  page: {
    width: number;
    height: number;
    tolerance: number;
  };
  ink: {
    maxTac: number;
    tacTolerance: number;
  };
  lint: {
    enabled: boolean;
    configPath: string | null;
  };
}
