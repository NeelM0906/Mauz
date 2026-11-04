// Reads what Mauz needs from a page: the element under the pointer, the card around it, the
// main text, and the product data shops publish for search engines. Pure functions take plain
// values so they can be tested without a browser; the DOM readers are thin wrappers.
(function (root) {
  "use strict";

  const MAX_PAGE_TEXT = 8000;
  const MAX_AROUND_TEXT = 4000;
  const MAX_ELEMENT_TEXT = 2000;
  const MAX_SELECTION = 8000;
  const MAX_FIELD = 300;
  const MAX_TITLE = 500;
  const MAX_JSON_LD_SCRIPTS = 20;
  const MAX_JSON_LD_CHARS = 300000;
  // A group larger than this share of the viewport is a page section, not "the thing".
  const MAX_GROUP_VIEWPORT_SHARE = 0.4;

  function clean(value, max) {
    if (typeof value === "number" && Number.isFinite(value)) {
      value = String(value);
    }

    if (typeof value !== "string") {
      return undefined;
    }

    const text = value.replace(/\s+/g, " ").trim();

    return text.length === 0 ? undefined : text.slice(0, max);
  }

  /** Like clean, but keeps line breaks (one per non-empty line). */
  function cleanBlock(value, max) {
    if (typeof value !== "string") {
      return undefined;
    }

    const text = value
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");

    return text.length === 0 ? undefined : text.slice(0, max);
  }

  function asArray(value) {
    if (value === undefined || value === null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /** Matches "Product", "schema:Product", and "https://schema.org/Product". */
  function hasType(node, type) {
    return asArray(node && node["@type"]).some((value) => {
      if (typeof value !== "string") {
        return false;
      }

      const short = value.split(/[/:#]/).pop();

      return short !== undefined && short.toLowerCase() === type.toLowerCase();
    });
  }

  /** "https://schema.org/InStock" → "InStock". */
  function shortEnum(value) {
    const text = clean(value, MAX_FIELD);

    return text === undefined ? undefined : text.split(/[/:#]/).pop();
  }

  function nameOf(value) {
    if (isObject(value)) {
      return clean(value.name, MAX_FIELD);
    }

    if (Array.isArray(value)) {
      return clean(
        value
          .map((item) => nameOf(item))
          .filter(Boolean)
          .join(", "),
        MAX_FIELD
      );
    }

    return clean(value, MAX_FIELD);
  }

  /** Every object in a JSON-LD document, including @graph members and nested values. */
  function collectNodes(value, nodes, depth) {
    if (depth > 6 || nodes.length > 500) {
      return nodes;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectNodes(item, nodes, depth + 1));
    } else if (isObject(value)) {
      nodes.push(value);
      Object.keys(value).forEach((key) => {
        if (key !== "@context") {
          collectNodes(value[key], nodes, depth + 1);
        }
      });
    }

    return nodes;
  }

  function compact(object) {
    const result = {};

    Object.keys(object).forEach((key) => {
      if (object[key] !== undefined) {
        result[key] = object[key];
      }
    });

    return Object.keys(result).length === 0 ? undefined : result;
  }

  function productFromJsonLd(texts) {
    const nodes = [];

    texts.slice(0, MAX_JSON_LD_SCRIPTS).forEach((text) => {
      if (typeof text !== "string" || text.length > MAX_JSON_LD_CHARS) {
        return;
      }

      try {
        collectNodes(JSON.parse(text), nodes, 0);
      } catch (_error) {
        // Shops sometimes publish broken JSON-LD; skip it.
      }
    });

    const product =
      nodes.find((node) => hasType(node, "Product")) ?? nodes.find((node) => hasType(node, "ProductGroup"));

    if (product === undefined) {
      return undefined;
    }

    const offers = asArray(product.offers).flatMap((offer) =>
      hasType(offer, "AggregateOffer") ? [offer].concat(asArray(offer.offers)) : [offer]
    );
    const aggregate = offers.find((offer) => hasType(offer, "AggregateOffer"));
    const offer = offers.find(
      (candidate) =>
        isObject(candidate) &&
        !hasType(candidate, "AggregateOffer") &&
        (candidate.price !== undefined || isObject(candidate.priceSpecification))
    );
    const priceSpecification = offer && isObject(offer.priceSpecification) ? offer.priceSpecification : {};
    const rating = isObject(product.aggregateRating) ? product.aggregateRating : {};

    return compact({
      name: clean(product.name, MAX_FIELD),
      brand: nameOf(product.brand),
      sku: clean(product.sku, MAX_FIELD),
      gtin: clean(
        product.gtin13 ?? product.gtin ?? product.gtin12 ?? product.gtin14 ?? product.gtin8,
        MAX_FIELD
      ),
      color: nameOf(product.color),
      size: nameOf(product.size),
      material: nameOf(product.material),
      price: clean(offer?.price ?? priceSpecification.price, MAX_FIELD),
      priceCurrency: clean(
        offer?.priceCurrency ?? priceSpecification.priceCurrency ?? aggregate?.priceCurrency,
        MAX_FIELD
      ),
      lowPrice: clean(aggregate?.lowPrice, MAX_FIELD),
      highPrice: clean(aggregate?.highPrice, MAX_FIELD),
      availability: shortEnum(offer?.availability ?? aggregate?.availability),
      rating: clean(rating.ratingValue, MAX_FIELD),
      reviewCount: clean(rating.reviewCount ?? rating.ratingCount, MAX_FIELD),
      seller: nameOf(offer?.seller)
    });
  }

  /** Open Graph and the product: namespace (Facebook/Pinterest shop tags). */
  function productFromMeta(meta) {
    const isProduct =
      /product/i.test(meta["og:type"] ?? "") ||
      meta["product:price:amount"] !== undefined ||
      meta["og:price:amount"] !== undefined;

    if (!isProduct) {
      return undefined;
    }

    return compact({
      name: clean(meta["og:title"], MAX_FIELD),
      brand: clean(meta["product:brand"], MAX_FIELD),
      price: clean(meta["product:price:amount"] ?? meta["og:price:amount"], MAX_FIELD),
      priceCurrency: clean(meta["product:price:currency"] ?? meta["og:price:currency"], MAX_FIELD),
      availability: shortEnum(meta["product:availability"] ?? meta["og:availability"]),
      color: clean(meta["product:color"], MAX_FIELD),
      size: clean(meta["product:size"], MAX_FIELD),
      material: clean(meta["product:material"], MAX_FIELD),
      sku: clean(meta["product:retailer_item_id"], MAX_FIELD)
    });
  }

  /** JSON-LD first; microdata and meta tags fill fields it lacks. */
  function extractProduct(input) {
    const sources = [
      productFromJsonLd(input.jsonLd ?? []),
      compact(input.microdata ?? {}),
      productFromMeta(input.meta ?? {})
    ].filter(Boolean);

    if (sources.length === 0) {
      return undefined;
    }

    const product = {};

    sources.forEach((source) => {
      Object.keys(source).forEach((key) => {
        if (product[key] === undefined) {
          product[key] = source[key];
        }
      });
    });

    return product.name === undefined && product.price === undefined && product.lowPrice === undefined
      ? undefined
      : product;
  }

  /**
   * "example.com" matches the site and its subdomains; a pattern with * is a wildcard over the
   * whole host ("*bank*").
   */
  function isBlockedHost(host, patterns) {
    const normalizedHost = String(host || "").toLowerCase();

    return asArray(patterns).some((pattern) => {
      const normalized = String(pattern || "")
        .trim()
        .toLowerCase();

      if (normalized.length === 0) {
        return false;
      }

      if (normalized.includes("*")) {
        const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");

        return new RegExp(`^${escaped}$`).test(normalizedHost);
      }

      return normalizedHost === normalized || normalizedHost.endsWith(`.${normalized}`);
    });
  }

  // ----- DOM readers -----

  function readMeta(doc) {
    const meta = {};

    doc.querySelectorAll("meta[property], meta[name]").forEach((element) => {
      const key = (element.getAttribute("property") || element.getAttribute("name") || "").toLowerCase();

      if ((key.startsWith("og:") || key.startsWith("product:")) && meta[key] === undefined) {
        const content = element.getAttribute("content");

        if (content !== null) {
          meta[key] = content;
        }
      }
    });

    return meta;
  }

  function readJsonLd(doc) {
    return Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
      .slice(0, MAX_JSON_LD_SCRIPTS)
      .map((script) => script.textContent || "");
  }

  function readMicrodata(doc) {
    const scope = doc.querySelector('[itemscope][itemtype*="schema.org/Product" i]');

    if (scope === null) {
      return undefined;
    }

    const prop = (name) => {
      const element = scope.querySelector(`[itemprop="${name}"]`);

      if (element === null) {
        return undefined;
      }

      return clean(element.getAttribute("content") ?? element.textContent, MAX_FIELD);
    };

    return {
      name: prop("name"),
      brand: prop("brand"),
      sku: prop("sku"),
      color: prop("color"),
      price: prop("price"),
      priceCurrency: prop("priceCurrency"),
      availability: shortEnum(prop("availability"))
    };
  }

  function area(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function describePointed(element, viewportArea) {
    const rect = element.getBoundingClientRect();
    const link = element.closest("a[href]");
    const small = area(rect) <= viewportArea * MAX_GROUP_VIEWPORT_SHARE;

    return {
      tag: element.tagName.toLowerCase().slice(0, 40),
      role: clean(element.getAttribute("role"), 80),
      text: small ? cleanBlock(element.innerText, MAX_ELEMENT_TEXT) : undefined,
      href: link === null ? undefined : clean(link.href, 2000),
      alt: clean(element.getAttribute("alt") ?? element.getAttribute("aria-label"), MAX_TITLE)
    };
  }

  /** Text of the highest ancestor that is still a small part of the viewport (the card). */
  function readAround(element, viewportArea) {
    let group = null;

    const body = element.ownerDocument.body;

    for (let node = element.parentElement; node !== null && node !== body; node = node.parentElement) {
      if (area(node.getBoundingClientRect()) > viewportArea * MAX_GROUP_VIEWPORT_SHARE) {
        break;
      }

      group = node;
    }

    return group === null ? undefined : cleanBlock(group.innerText, MAX_AROUND_TEXT);
  }

  function readMainText(doc) {
    const main = doc.querySelector("main, article, [role='main']") || doc.body;

    return main === null ? undefined : cleanBlock(main.innerText, MAX_PAGE_TEXT);
  }

  function snapshot(doc, pointer) {
    const view = doc.defaultView;
    const viewportArea = view.innerWidth * view.innerHeight;
    const pointed = pointer === null ? null : doc.elementFromPoint(pointer.x, pointer.y);

    return compactPage({
      title: clean(doc.title, MAX_TITLE),
      selection: cleanBlock(view.getSelection ? view.getSelection().toString() : "", MAX_SELECTION),
      element: pointed === null ? undefined : compact(describePointed(pointed, viewportArea)),
      around: pointed === null ? undefined : readAround(pointed, viewportArea),
      text: readMainText(doc),
      product: extractProduct({ jsonLd: readJsonLd(doc), meta: readMeta(doc), microdata: readMicrodata(doc) })
    });
  }

  function compactPage(page) {
    return compact(page) || {};
  }

  const api = { extractProduct, isBlockedHost, snapshot, clean, cleanBlock };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MauzPage = api;
  }
})(typeof globalThis === "object" ? globalThis : this);
