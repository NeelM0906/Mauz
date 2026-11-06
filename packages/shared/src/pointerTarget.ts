import type { BrowserProduct, PointerTargetElement } from "./types";

/** Short label for UI, such as `Button "Add to cart"`. */
export function describeElement(element: PointerTargetElement): string {
  const name = element.name?.replace(/\s+/g, " ").trim();

  if (name === undefined || name.length === 0) {
    return element.role;
  }

  return `${element.role} "${name.length > 80 ? `${name.slice(0, 77)}...` : name}"`;
}

export function formatProduct(product: BrowserProduct): string {
  const price =
    product.price !== undefined
      ? [product.price, product.priceCurrency].filter(Boolean).join(" ")
      : product.lowPrice !== undefined
        ? `${product.lowPrice}${product.highPrice === undefined ? "" : ` to ${product.highPrice}`}${product.priceCurrency === undefined ? "" : ` ${product.priceCurrency}`}`
        : undefined;
  const rating =
    product.rating === undefined
      ? undefined
      : `${product.rating}${product.reviewCount === undefined ? "" : ` (${product.reviewCount} reviews)`}`;
  const fields: Array<[string, string | undefined]> = [
    ["name", product.name],
    ["brand", product.brand],
    ["price", price],
    ["availability", product.availability],
    ["color", product.color],
    ["size", product.size],
    ["material", product.material],
    ["rating", rating],
    ["seller", product.seller],
    ["sku", product.sku],
    ["gtin", product.gtin]
  ];

  return fields
    .filter((field): field is [string, string] => field[1] !== undefined)
    .map(([label, value]) => `${label}: ${value}`)
    .join("; ");
}
