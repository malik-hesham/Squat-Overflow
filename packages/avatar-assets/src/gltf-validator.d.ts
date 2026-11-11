// The Khronos validator ships without TypeScript types; this is the part the model test uses.
declare module 'gltf-validator' {
  interface Issue {
    readonly code: string;
    readonly message: string;
    /** 0 error, 1 warning, 2 info, 3 hint. */
    readonly severity: number;
    readonly pointer?: string;
  }
  interface Report {
    readonly issues: { readonly numErrors: number; readonly messages: readonly Issue[] };
  }
  const validator: {
    validateBytes(data: Uint8Array, options?: { maxIssues?: number }): Promise<Report>;
  };
  export default validator;
}
