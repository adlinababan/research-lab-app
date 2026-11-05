// Penomoran ulang sitasi sesuai urutan kemunculan (aturan IEEE).

const CITE_RE = /\[(\d+)\]/g;

/**
 * sections: [{heading, paragraphs}], matrixRows: [{n}] (dianggap dikutip setelah bagian ke-2)
 * returns { map: Map(old->new), order: [old...] }
 */
export function citationOrder(sections, matrixRows, matrixAfter = 1) {
  const order = [];
  const seen = new Set();
  const visit = (n) => { if (!seen.has(n)) { seen.add(n); order.push(n); } };
  (sections || []).forEach((s, idx) => {
    for (const p of s.paragraphs || []) {
      for (const m of String(p).matchAll(CITE_RE)) visit(Number(m[1]));
    }
    if (idx === matrixAfter) for (const r of matrixRows || []) visit(Number(r.n));
  });
  const map = new Map(order.map((old, i) => [old, i + 1]));
  return { map, order };
}

export function renumberText(text, map) {
  return String(text || "").replace(CITE_RE, (m, n) => (map.has(Number(n)) ? `[${map.get(Number(n))}]` : ""));
}
