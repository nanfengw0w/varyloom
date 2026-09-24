/** Public paths work both at localhost / and GitHub Pages /varyloom/. */
export function sitePath(path: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
