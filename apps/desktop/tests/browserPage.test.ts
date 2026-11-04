import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { isBlockedSite } from "@mauzai/shared";

type BrowserPageModule = {
  extractProduct(input: {
    jsonLd?: string[];
    meta?: Record<string, string>;
    microdata?: Record<string, string | undefined>;
  }): Record<string, string> | undefined;
  isBlockedHost(host: string, patterns: string[]): boolean;
};

const require = createRequire(import.meta.url);
const page = require("../../../browser-extension/extension/page.js") as BrowserPageModule;

describe("browser extension product data", () => {
  it("reads a schema.org Product with an offer and rating", () => {
    const product = page.extractProduct({
      jsonLd: [
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Sony WH-1000XM5 Wireless Headphones",
          brand: { "@type": "Brand", name: "Sony" },
          color: "Black",
          gtin13: "4548736132610",
          offers: {
            "@type": "Offer",
            price: 328,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            seller: { "@type": "Organization", name: "Example Shop" }
          },
          aggregateRating: { "@type": "AggregateRating", ratingValue: 4.6, reviewCount: 1234 }
        })
      ]
    });

    expect(product).toEqual({
      name: "Sony WH-1000XM5 Wireless Headphones",
      brand: "Sony",
      color: "Black",
      gtin: "4548736132610",
      price: "328",
      priceCurrency: "USD",
      availability: "InStock",
      seller: "Example Shop",
      rating: "4.6",
      reviewCount: "1234"
    });
  });

  it("finds the product inside @graph and reads price ranges", () => {
    const product = page.extractProduct({
      jsonLd: [
        "not json",
        JSON.stringify({
          "@graph": [
            { "@type": "WebPage", name: "Shop" },
            {
              "@type": ["schema:Product"],
              name: "Trail Shoe",
              size: ["8", "9", "10"],
              offers: {
                "@type": "AggregateOffer",
                lowPrice: "89.99",
                highPrice: "119.99",
                priceCurrency: "EUR"
              }
            }
          ]
        })
      ]
    });

    expect(product).toMatchObject({
      name: "Trail Shoe",
      size: "8, 9, 10",
      lowPrice: "89.99",
      highPrice: "119.99",
      priceCurrency: "EUR"
    });
  });

  it("falls back to microdata and Open Graph product tags", () => {
    expect(
      page.extractProduct({
        microdata: { name: "Desk Lamp", price: "39.00", priceCurrency: undefined },
        meta: { "og:type": "product", "product:price:currency": "GBP", "product:brand": "Lumen" }
      })
    ).toEqual({ name: "Desk Lamp", price: "39.00", priceCurrency: "GBP", brand: "Lumen" });
  });

  it("returns nothing for pages that are not products", () => {
    expect(page.extractProduct({ jsonLd: [JSON.stringify({ "@type": "Article", name: "News" })] })).toBe(
      undefined
    );
    expect(page.extractProduct({ meta: { "og:type": "website", "og:title": "Home" } })).toBe(undefined);
  });
});

describe("never-capture sites", () => {
  const patterns = ["paypal.com", "*bank*", "mychart.*"];
  const cases: Array<[string, boolean]> = [
    ["paypal.com", true],
    ["www.paypal.com", true],
    ["notpaypal.com", false],
    ["online.examplebank.co.uk", true],
    ["mychart.example.org", true],
    ["en.wikipedia.org", false]
  ];

  it.each(cases)("%s is blocked: %s (the app and the extension agree)", (host, blocked) => {
    expect(isBlockedSite(host, patterns)).toBe(blocked);
    expect(page.isBlockedHost(host, patterns)).toBe(blocked);
  });
});
