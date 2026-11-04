// Penomoran ulang sitasi sesuai urutan kemunculan (aturan IEEE) + pernyataan penggunaan AI.

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

export function aiDisclosure(lang, label, model) {
  const sys = `${label}${model ? ` (${model})` : ""}`;
  if (lang === "id") {
    return `Penulis menggunakan sistem AI generatif ${sys} melalui aplikasi Research Lab untuk membantu merumuskan pertanyaan riset, mengusulkan kata kunci pencarian, menyusun matriks gap (Tabel I), dan menyusun draf awal seluruh bagian naskah. Literatur diambil dari basis data OpenAlex. Seluruh referensi telah diverifikasi dan seluruh isi telah ditinjau serta disunting oleh penulis, yang bertanggung jawab penuh atas naskah ini. [Sesuaikan dengan kontribusi AI yang sebenarnya dan tambahkan pendanaan bila ada.]`;
  }
  return `The authors used the generative AI system ${sys}, through the Research Lab application, to help formulate the research question, suggest search keywords, build the gap matrix (Table I), and prepare an initial draft of all sections of this paper. Literature was retrieved from the OpenAlex database. All references were verified, and all content was reviewed and edited by the authors, who take full responsibility for this paper. [Adjust to the actual extent of AI use and add funding information if any.]`;
}
