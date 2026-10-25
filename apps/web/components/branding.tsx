import { publicGet } from "@/lib/server";

export interface Branding {
  slug: string;
  name: string;
  logoUrl: string | null;
}

export const getBranding = (slug: string) => publicGet<Branding>(`/public/institutes/${slug}`, 300);

export function BrandMark({ brand }: { brand: Branding | null }) {
  if (!brand) return null;
  return brand.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logoUrl} alt={brand.name} className="mx-auto h-14 w-auto object-contain" />
  ) : (
    <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-brand-600 text-lg font-semibold text-white">{brand.name.slice(0, 1)}</div>
  );
}
