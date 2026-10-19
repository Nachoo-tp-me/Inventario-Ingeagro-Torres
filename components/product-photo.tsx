"use client";

import { useEffect, useRef } from "react";
import { ImageOff, Package } from "lucide-react";

// A signed URL can expire or fail. The fallback icon always sits behind the <img>; a failed image is
// simply hidden (also when it failed before hydration, so onError never fired). No state, no new fetching.
function useImageFallback() {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = ref.current;
    if (image && image.complete && image.naturalWidth === 0) fail(image);
  }, []);
  return ref;
}

function fail(image: HTMLImageElement) {
  image.hidden = true;
  image.closest<HTMLElement>("[data-photo]")?.setAttribute("data-failed", "true");
}

export function ProductThumb({ url }: { url: string | null }) {
  const ref = useImageFallback();
  return <span className="catalog-thumb" data-photo aria-hidden="true">
    <Package size={22} />
    {url && (
      // Signed URL of the private bucket.
      // eslint-disable-next-line @next/next/no-img-element
      <img ref={ref} src={url} alt="" loading="lazy" onError={event => fail(event.currentTarget)} />
    )}
  </span>;
}

export function ProductPhoto({ url, name }: { url: string | null; name: string }) {
  const ref = useImageFallback();
  return <div className="catalog-photo-frame" data-photo>
    {url && (
      // eslint-disable-next-line @next/next/no-img-element
      <img ref={ref} src={url} alt={`Fotografía de ${name}`} onError={event => fail(event.currentTarget)} />
    )}
    <p className="catalog-photo-fallback">
      {url ? <ImageOff size={18} aria-hidden="true" /> : <Package size={18} aria-hidden="true" />}
      <span className="catalog-photo-missing">Sin fotografía</span>
      <span className="catalog-photo-failed">No se pudo cargar la fotografía</span>
    </p>
  </div>;
}
